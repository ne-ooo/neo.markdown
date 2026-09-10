import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = fileURLToPath(new URL('../..', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const entries = ['./incremental', './dom', './worker', './worker-client', './application', './application/sync', './application/react']
const files = entries.flatMap(entry => ['import','require'].map(format => resolve(root,manifest.exports[entry][format].types)))
const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, strict: true })
const checker = program.getTypeChecker(), flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
const printType = type => checker.typeToString(type, undefined, flags).replace(/import\("[^"]+"\)\./g, '')
function surface(file) {
  const source = program.getSourceFile(file)
  return Object.fromEntries(checker.getExportsOfModule(checker.getSymbolAtLocation(source)).sort((a,b)=>a.name.localeCompare(b.name)).map(exported => {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = symbol.declarations?.[0]
    const declared = !!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class))
    const type = declared ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeOfSymbolAtLocation(symbol, declaration)
    const value = { kind: symbol.flags & ts.SymbolFlags.Class ? 'class' : declared ? 'type' : 'value', type: printType(type) }
    // Record public member shapes as well as aliases, so named interfaces cannot hide incompatible changes.
    if (declared && !(type.flags & ts.TypeFlags.Union) && !(type.flags & ts.TypeFlags.StringLike)) {
      value.members = Object.fromEntries(type.getProperties().filter(property => property.declarations?.some(d => d.getSourceFile().fileName.startsWith(resolve(root,'dist')))).sort((a,b)=>a.name.localeCompare(b.name)).map(property => {
        const declarations=property.declarations ?? []
        return [property.name, { optional: !!(property.flags & ts.SymbolFlags.Optional), readonly: declarations.some(d=>d.modifiers?.some(m=>m.kind===ts.SyntaxKind.ReadonlyKeyword)), type: printType(checker.getTypeOfSymbolAtLocation(property,declarations[0]??declaration)) }]
      }))
    }
    if (type.isUnion()) value.variants = type.types.map(printType).sort()
    if (symbol.flags & ts.SymbolFlags.Class) value.constructors = checker.getTypeOfSymbolAtLocation(symbol,declaration).getConstructSignatures().map(signature=>checker.signatureToString(signature,undefined,flags))
    return [exported.name,value]
  }))
}
const actual = {}
for (const entry of entries) {
  const imported=surface(resolve(root,manifest.exports[entry].import.types)), required=surface(resolve(root,manifest.exports[entry].require.types))
  assert.deepEqual(required,imported,entry+' ESM/CJS declarations must match')
  actual[entry]=imported
}
const path=resolve(root,'test/package/api-surface.json')
if(process.argv.includes('--update')) await writeFile(path,JSON.stringify(actual,null,2)+'\n')
else assert.deepEqual(actual,JSON.parse(await readFile(path,'utf8')),'Review public API changes before updating the compatibility snapshot')
console.log('Stable API declarations match across formats and the reviewed compatibility snapshot; Node ' + process.version)
