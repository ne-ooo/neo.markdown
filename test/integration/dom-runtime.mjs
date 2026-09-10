import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)
const load = name => process.env.NEO_INTEGRATION_FORMAT === 'cjs' ? require(name) : import(name)
const { createMarkdownView } = await load('@lpm.dev/neo.markdown/experimental/dom')
const { createParser } = await load('@lpm.dev/neo.markdown')
const { sanitizeHtml, DEFAULT_ALLOWED_TAGS, DEFAULT_ALLOWED_ATTRIBUTES } = await load('@lpm.dev/neo.markdown/sanitized')
const { embedPlugin, initializeEmbeds } = await load('@lpm.dev/neo.markdown/plugins/embeds')
const { copyCodePlugin, initializeCopyCode } = await load('@lpm.dev/neo.markdown/plugins/copy-code')
const { codePresentationPlugin } = await load('@lpm.dev/neo.markdown/plugins/code-presentation')
const { tokenize, renderToHTML, getThemeStylesheet } = await load('@lpm.dev/neo.highlight')
const { javascript } = await load('@lpm.dev/neo.highlight/grammars/javascript')
const { githubDark } = await load('@lpm.dev/neo.highlight/themes/github-dark')
const fixtures = JSON.parse(await readFile(new URL('./dom-fixtures.json', import.meta.url), 'utf8'))
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously', url: 'https://example.test' })
const names = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'Node']
const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
for (const name of names) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true })
after(() => { dom.window.close(); names.forEach((name,i) => { if(descriptors[i])Object.defineProperty(globalThis,name,descriptors[i]);else delete globalThis[name] }) })
function container() { const root = document.createElement('div'); document.body.append(root); return root }
const expected = html => { const root = document.createElement('div'); root.innerHTML = html; return root.innerHTML }
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

for (const sanitize of [false, true]) test(`DOM parity through all CommonMark and GFM examples, sanitize=${sanitize}`, () => {
  const parser = createParser({ gfm: true, allowHtml: true, sanitize, sanitizer: sanitizeHtml })
  const root = container(), view = createMarkdownView(root)
  try { for (const fixture of fixtures) {
    const html = parser.parseDocument(fixture.markdown).html
    view.update(html)
    assert.equal(root.innerHTML, expected(html), 'example ' + (fixture.example ?? fixture.number))
  } } finally { view.dispose(); root.remove() }
})

test('prefix and suffix regions preserve identity, focus, selection, and scroll state', () => {
  const root = container(), mounted = [], removed = []
  const view = createMarkdownView(root, { initialize: node => { mounted.push(node); return () => removed.push(node) } })
  try {
    view.update('<p id="first">first</p><p>old</p><pre tabindex="0">last</pre>')
    const [first,middle,last] = root.children
    last.focus(); last.scrollLeft = 35; last.scrollTop = 17
    const range = document.createRange(); range.selectNodeContents(first); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    assert.deepEqual(view.update('<p id="first">first</p><p>new</p><pre tabindex="0">last</pre>'), { mode:'patch', reusedRegions:2, removedRegions:1, insertedRegions:1 })
    assert.equal(root.firstChild,first); assert.equal(root.lastChild,last); assert.equal(document.activeElement,last)
    assert.equal(last.scrollLeft,35); assert.equal(last.scrollTop,17); assert.equal(selection.anchorNode,first)
    assert.deepEqual(removed,[middle]); assert.equal(mounted.length,4)
    const snapshot = view.metrics; snapshot.cachedRegions = 0
    assert.equal(view.metrics.cachedRegions,3)
  } finally { view.dispose(); root.remove() }
  assert.equal(removed.length,4)
})

test('append, deletion, duplicates, reordering, and empty results match complete replacement', () => {
  const root=container(),view=createMarkdownView(root)
  const a='<p>same</p>', b='<p>different</p>'
  try {
    for(const html of [a+a+b,a+a+a+b,a+b,b+a,a,'',b,a+b+a]) {
      view.update(html); assert.equal(root.innerHTML,expected(html))
    }
  }finally{view.dispose();root.remove()}
})

test('first patch and recovery report removed children outside the snapshot', () => {
  const root = container(), view = createMarkdownView(root, { maxRegions: 2 })
  try {
    root.innerHTML = '<p>Existing</p><!-- existing comment -->text'
    assert.deepEqual(view.update('<p>First</p>'), { mode: 'patch', reusedRegions: 0, removedRegions: 3, insertedRegions: 1 })
    assert.equal(view.update('<p>A</p><p>B</p><p>C</p>').reason, 'region-limit')
    assert.deepEqual(view.update('<p>Recovered</p>'), { mode: 'patch', reusedRegions: 0, removedRegions: 3, insertedRegions: 1 })
    assert.equal(root.innerHTML, '<p>Recovered</p>')
  } finally { view.dispose(); root.remove() }
})

test('1,000 deterministic document edits preserve complete DOM output', () => {
  const root=container(),view=createMarkdownView(root),parser=createParser({gfm:true})
  let seed=9, blocks=Array.from({length:30},(_,i)=>`Paragraph ${i}: **bold** and [link](/url).\n\n`)
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed}
  try{for(let i=0;i<1000;i++){
    const at=rand()%(blocks.length+1)
    if(i%5===0&&blocks.length>10)blocks.splice(at,1)
    else if(i%3===0)blocks.splice(at,0,`- item ${i}\n- next\n\n`)
    else blocks[at]=`| A | B |\n| - | - |\n| ${i} | 😀 |\n\n`
    const html=parser.parseDocument(blocks.join('')).html;view.update(html);assert.equal(root.innerHTML,expected(html),String(i))
  }}finally{view.dispose();root.remove()}
})

for(const html of [
  '<script>window.executed = true</script><p>safe</p>',
  '<template><script>window.executed = true</script></template>',
  '<svg><text>foreign</text></svg>', '<math><mi>x</mi></math>', '<p onclick="window.executed = true">event</p>',
  '<style>p{color:red}</style><p>styled</p>', '<textarea>text</textarea>', '<x-dom-test>custom</x-dom-test>',
  '<button is="custom-button">custom built-in</button>', '<tr><td>context</td></tr>', '<colgroup><col></colgroup>',
]) test(`unsupported HTML uses replacement: ${html.slice(0,45)}`, () => {
  const root=container(),view=createMarkdownView(root)
  try{const result=view.update(html);assert.equal(result.mode,'replace');assert.equal(result.reason,'unsupported-html');assert.equal(root.innerHTML,expected(html));assert.equal(window.executed,undefined);assert.equal(view.metrics.cachedRegions,0)}finally{view.dispose();root.remove()}
})

test('HTML parsing context handles malformed tables, comments, entities, and quoted delimiters', () => {
  const root=container(),view=createMarkdownView(root)
  try{for(const html of ['<!-- x --><p title="a > b">&lt;script&gt;&amp;😀</p>','<table>before<tr><td>A<td>B</tr>after</table>','<p><div>nested</div></p>','<b><i>one</b>two</i>','<select><option>one<option>two</select>','<table><caption>title</caption><colgroup><col></colgroup><tr><td>x</td></tr></table>']){
    view.update(html);assert.equal(root.innerHTML,expected(html),html)
  }}finally{view.dispose();root.remove()}
})

test('form markup respects the live root ancestor parsing context', () => {
  const form = document.createElement('form'), root = document.createElement('div'), reference = document.createElement('div')
  form.append(root, reference); document.body.append(form)
  const view = createMarkdownView(root)
  try {
    for (const html of ['<form><input name="x"></form><p>end</p>', '<section><form><input></form></section>', '</form><form><input></form>']) {
      reference.innerHTML = html
      assert.equal(view.update(html).reason, 'unsupported-html')
      assert.equal(root.innerHTML, reference.innerHTML)
      assert.equal(view.metrics.cachedRegions, 0)
    }
  } finally { view.dispose(); form.remove() }
})

for(const [option,value,html,reason]of [
  ['maxCachedHtmlLength',5,'<p>text</p>','html-limit'],
  ['maxCachedHtmlLength',15,'<p>text</p>','html-limit'],
  ['maxNodes',2,'<p><b>text</b></p>','node-limit'],
  ['maxRegions',1,'<p>a</p><p>b</p>','region-limit'],
  ['maxDepth',2,'<div><p>text</p></div>','depth-limit'],
]) test(`${option} falls back without retained patch state`,()=>{
  const root=container(),view=createMarkdownView(root,{[option]:value})
  try{view.update('x');const report=view.update(html);assert.equal(report.reason,reason);assert.equal(root.innerHTML,expected(html));assert.equal(view.metrics.cachedHtmlCodeUnits,0);assert.equal(view.metrics.cachedRegions,0);view.update('');assert.equal(root.innerHTML,'')}
  finally{view.dispose();root.remove()}
})

test('limit validation and disposal release owned state',()=>{
  const root=container()
  for(const key of ['maxCachedHtmlLength','maxNodes','maxRegions','maxDepth'])for(const value of [-1,Infinity,0.5])assert.throws(()=>createMarkdownView(root,{[key]:value}),RangeError)
  assert.throws(()=>createMarkdownView(document.createElement('table')),TypeError)
  const view=createMarkdownView(root);view.update('<p>text</p>');view.dispose();view.dispose()
  assert.equal(root.childNodes.length,0);assert.equal(view.metrics.cachedHtmlCodeUnits,0);assert.throws(()=>view.update(''),/closed/);root.remove()
})

test('external top-level mutations cause full replacement and later updates recover patching',()=>{
  const root=container(),view=createMarkdownView(root)
  try{view.update('<p>first</p>');root.append(document.createElement('div'));assert.equal(view.update('<p>first</p>').reason,'external-mutation');assert.equal(root.innerHTML,'<p>first</p>');view.update('<p>new</p>');assert.equal(view.metrics.mode,'patch')}
  finally{view.dispose();root.remove()}
})

test('initializer-owned state survives edits outside its region',()=>{
  const root=container(),view=createMarkdownView(root,{initialize:node=>{if(node.localName==='details')node.open=true}})
  try{view.update('<details><summary>Title</summary>Body</details><p>old</p>');const details=root.firstChild;view.update('<details><summary>Title</summary>Body</details><p>new</p>');assert.equal(root.firstChild,details);assert.equal(details.open,true);assert.equal(view.update('<details><summary>Title</summary>Body</details><p>new</p>').mode,'unchanged')}
  finally{view.dispose();root.remove()}
})

test('initializer errors close the view without retrying and release earlier scopes',()=>{
  const root=container(),failure=new Error('initializer failure'),stopped=[];let calls=0
  const view=createMarkdownView(root,{initialize:node=>{calls++;if(node.textContent==='fail')throw failure;return()=>stopped.push(node)}})
  assert.throws(()=>view.update('<p>first</p><p>fail</p>'),error=>error===failure)
  assert.equal(calls,2);assert.equal(stopped.length,1);assert.equal(root.childNodes.length,0);assert.equal(view.metrics.cachedRegions,0);assert.throws(()=>view.update(''),/closed/);root.remove()
})

test('cleanup errors still release all regions and clear DOM',()=>{
  const root=container(),failure=new Error('cleanup failure'),stopped=[]
  const view=createMarkdownView(root,{initialize:node=>()=>{stopped.push(node);if(node.textContent==='first')throw failure}})
  view.update('<p>first</p><p>last</p>');assert.throws(()=>view.update(''),error=>error===failure)
  assert.equal(stopped.length,2);assert.equal(root.childNodes.length,0);view.dispose();root.remove()
})

for(const operation of ['dispose','reenter'])test(`${operation} inside initialization prevents an accepted update`,()=>{
  const root=container();let cleanup=0,view
  view=createMarkdownView(root,{initialize:()=>{if(operation==='dispose')view.dispose();else try{view.update('nested')}catch{};return()=>cleanup++}})
  assert.throws(()=>view.update('<p>text</p>'),/closed/);assert.equal(cleanup,1);assert.equal(view.metrics.updates,0);assert.equal(root.childNodes.length,0);root.remove()
})

test('initializer cannot change top-level region ownership',()=>{
  const root=container();let cleanup=0
  const view=createMarkdownView(root,{initialize:()=>{root.append(document.createElement('p'));return()=>cleanup++}})
  assert.throws(()=>view.update('<p>text</p>'),/ownership/);assert.equal(cleanup,1);assert.equal(root.childNodes.length,0);root.remove()
})

test('copy feedback and handlers survive unrelated edits and stop on removal',async()=>{
  const root=container(),parser=createParser({plugins:[copyCodePlugin({injectStyles:false})]})
  const view=createMarkdownView(root,{initialize:node=>initializeCopyCode({root:node,resetDelay:20})})
  const copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>copies.push(text)}})
  try{
    view.update(parser.parse('```js\nconst x = 1;\n```\n\nold'));const button=root.querySelector('button');button.click();await flush()
    assert.equal(button.textContent,'Copied!');view.update(parser.parse('```js\nconst x = 1;\n```\n\nnew'))
    assert.equal(root.querySelector('button'),button);assert.equal(button.textContent,'Copied!');button.click();await flush();assert.equal(copies.length,2)
    view.update('<p>replacement</p>');button.click();await flush();assert.equal(copies.length,2)
  }finally{view.dispose();root.remove()}
})

test('consented embeds preserve live iframes until their own region changes',()=>{
  const root=container(),parser=createParser({plugins:[embedPlugin({youtube:true,consent:true})]}),view=createMarkdownView(root,{initialize:node=>initializeEmbeds({root:node})})
  try{
    view.update(parser.parse('::youtube[dQw4w9WgXcQ]\n\nold'));root.querySelector('button').click();const frame=root.querySelector('iframe');assert.ok(frame)
    view.update(parser.parse('::youtube[dQw4w9WgXcQ]\n\nnew'));assert.equal(root.querySelector('iframe'),frame);assert.equal(root.querySelector('button'),null)
    view.update(parser.parse('::youtube[abcdefghijk]\n\nnew'));assert.equal(frame.isConnected,false);assert.ok(root.querySelector('button'))
  }finally{view.dispose();root.remove()}
})

test('root Gist activation and shared Twitter loader scopes clean up independently',()=>{
  const gist=container();gist.setAttribute('data-embed-gist','');gist.setAttribute('data-gist-src','https://gist.github.com/user/abc123.js')
  const releaseGist=initializeEmbeds({root:gist});assert.ok(gist.querySelector('iframe[data-neo-embed-gist]'));releaseGist();gist.remove()
  const a=container(),b=container();a.className=b.className='twitter-tweet'
  const disposeA=initializeEmbeds({root:a}),disposeB=initializeEmbeds({root:b});const script=document.querySelector('script[data-neo-embed-twitter]');assert.ok(script)
  disposeA();const loaded=[];globalThis.twttr={widgets:{load:root=>loaded.push(root)}}
  try{script.dispatchEvent(new window.Event('load'));assert.deepEqual(loaded,[b]);disposeB();script.dispatchEvent(new window.Event('load'));assert.equal(loaded.length,1)}
  finally{delete globalThis.twttr;disposeA();disposeB();script.remove();a.remove();b.remove()}
})

test('nested code and list edits retain containers, syntax nodes, focus, selection, and scroll', () => {
  const root = container(), view = createMarkdownView(root)
  const old = '<blockquote><ul><li>first</li><li><pre tabindex="0"><code><span class="keyword">const</span> old</code></pre></li><li>end</li></ul></blockquote>'
  try {
    view.update(old)
    const block = root.firstChild, list = root.querySelector('ul'), first = list.firstChild, last = list.lastChild
    const pre = root.querySelector('pre'), code = root.querySelector('code'), keyword = root.querySelector('span'), text = keyword.firstChild
    pre.focus(); pre.scrollLeft = 30; pre.scrollTop = 18
    const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(text); selection.removeAllRanges(); selection.addRange(range)
    const next = old.replace(' old', ' new <span class="number">42</span>')
    assert.deepEqual(view.update(next), { mode:'patch', reusedRegions:0, removedRegions:0, insertedRegions:0, patchedRegions:1 })
    assert.equal(root.innerHTML, next); assert.equal(root.firstChild, block); assert.equal(root.querySelector('ul'), list)
    assert.equal(list.firstChild, first); assert.equal(list.lastChild, last); assert.equal(root.querySelector('pre'), pre); assert.equal(root.querySelector('code'), code)
    assert.equal(root.querySelector('span'), keyword); assert.equal(document.activeElement, pre); assert.equal(pre.scrollLeft, 30); assert.equal(pre.scrollTop, 18)
    assert.equal(selection.anchorNode, text); assert.equal(selection.toString(), 'const')
  } finally { window.getSelection().removeAllRanges(); view.dispose(); root.remove() }
})

test('multiple edits retain unchanged middle descendants without moving them', () => {
  const root = container(), view = createMarkdownView(root)
  try {
    view.update('<section><p>old first</p><p>keep</p><p>old last</p></section>')
    const section = root.firstChild, middle = section.childNodes[1], text = middle.firstChild
    view.update('<section><p>new first</p><p>keep</p><p>new last</p></section>')
    assert.equal(root.firstChild, section); assert.equal(section.childNodes[1], middle); assert.equal(middle.firstChild, text)
  } finally { view.dispose(); root.remove() }
})

test('unchanged middle regions skip lifecycle updates between separate edits', () => {
  const root = container(), updates = []
  const view = createMarkdownView(root, { initialize: node => ({ dispose() {}, update: () => updates.push(node.textContent) }) })
  try {
    view.update('<p>old first</p><p>keep</p><p>old last</p>'); const middle = root.childNodes[1]
    const result = view.update('<p>new first</p><p>keep</p><p>new last</p>')
    assert.equal(root.childNodes[1], middle); assert.deepEqual(updates, ['new first', 'new last'])
    assert.equal(result.reusedRegions, 1); assert.equal(result.patchedRegions, 2)
  } finally { view.dispose(); root.remove() }
})

test('equal snapshot reuse never shares live nodes or initialized state across duplicate regions', () => {
  const root = container(); let starts = 0
  const view = createMarkdownView(root, { initialize: node => {
    node.querySelector('button').textContent = String(++starts)
    return { dispose() {}, update() {} }
  } })
  const a = '<section><button>A</button></section>', z = '<section><button>Z</button></section>'
  try {
    view.update(a); const first = root.firstChild
    view.update(a+a); const second = root.lastChild
    assert.notEqual(first, second); assert.equal(first.textContent, '1'); assert.equal(second.textContent, '2')
    view.update(z+a); assert.equal(first.textContent, 'Z'); assert.equal(second.textContent, '2')
    view.update(a+a); assert.equal(first.textContent, 'A'); assert.equal(second.textContent, '2')
    assert.equal(root.firstChild, first); assert.equal(root.lastChild, second); assert.equal(starts, 2)
  } finally { view.dispose(); root.remove() }
})

test('table row insertion, deletion, and cell edits preserve surrounding rows', () => {
  const root = container(), view = createMarkdownView(root)
  const table = value => `<table><tbody><tr><td>first</td></tr>${value}<tr><td>last</td></tr></tbody></table>`
  try {
    view.update(table('<tr><td>old</td></tr>'))
    const element = root.firstChild, first = root.querySelector('tr'), last = root.querySelector('tbody').lastChild
    for (const value of ['<tr><td>new</td></tr>', '<tr><td>new</td></tr><tr><td>added</td></tr>', '', '<tr><th>heading</th><td>cell</td></tr>']) {
      const html = table(value); view.update(html)
      assert.equal(root.innerHTML, html); assert.equal(root.firstChild, element); assert.equal(root.querySelector('tr'), first); assert.equal(root.querySelector('tbody').lastChild, last)
    }
  } finally { view.dispose(); root.remove() }
})

test('nested text edits preserve exact Unicode, CRLF normalization, entities, and empty transitions', () => {
  const root = container(), view = createMarkdownView(root)
  try {
    for (const text of ['A😀éB', 'A😁éB', 'A😁éB', 'A&amp;\r\nB', '', '&lt;span&gt;', '\ud83d', '\ud83d\ude00']) {
      const html = `<pre><code>${text}</code></pre>`; view.update(html); assert.equal(root.innerHTML, expected(html))
    }
  } finally { view.dispose(); root.remove() }
})

test('hash collisions still compare complete canonical structure before reuse', () => {
  const root = container(), view = createMarkdownView(root)
  try {
    // These different text signatures collide under the candidate-rejection hash.
    view.update('<p>word25940d7065c9097d</p>')
    view.update('<p>word6a957b18c643450b</p>')
    assert.equal(root.innerHTML, '<p>word6a957b18c643450b</p>')
  } finally { view.dispose(); root.remove() }
})

test('attribute values and order match replacement while changed IDs replace identity', () => {
  const root = container(), view = createMarkdownView(root)
  try {
    view.update('<section id="one" title="old" class="a"><p>body</p></section>'); const first = root.firstChild
    for (const html of ['<section id="one" title="new" class="b"><p>body</p></section>', '<section class="b" id="one"><p>body</p></section>']) {
      view.update(html); assert.equal(root.innerHTML, html); assert.equal(root.firstChild, first)
    }
    view.update('<section id="two"><p>body</p></section>'); assert.notEqual(root.firstChild, first)
  } finally { view.dispose(); root.remove() }
})

test('unchanged controls retain live state and changed controls are atomic', () => {
  const root = container(), view = createMarkdownView(root)
  try {
    view.update('<section><input type="checkbox"><details><summary>Title</summary>Body</details><p>old</p></section>')
    const input = root.querySelector('input'), details = root.querySelector('details'); input.checked = true; details.open = true
    view.update('<section><input type="checkbox"><details><summary>Title</summary>Body</details><p>new</p></section>')
    assert.equal(root.querySelector('input'), input); assert.equal(input.checked, true); assert.equal(root.querySelector('details'), details); assert.equal(details.open, true)
    view.update('<section><input type="checkbox" disabled><details><summary>New</summary>Body</details><p>new</p></section>')
    assert.notEqual(root.querySelector('input'), input); assert.notEqual(root.querySelector('details'), details)
  } finally { view.dispose(); root.remove() }
})

test('ordinary initializer callbacks keep replacement while explicit lifecycles receive updates', () => {
  const root = container(); let starts = 0, stops = 0, updates = 0
  const legacy = createMarkdownView(root, { initialize: () => { starts++; return () => stops++ } })
  legacy.update('<p>old</p>'); const old = root.firstChild; legacy.update('<p>new</p>')
  assert.notEqual(root.firstChild, old); assert.equal(starts, 2); assert.equal(stops, 1); legacy.dispose()
  const state = { dispose() { stops++ }, update() { assert.equal(this, state); updates++ } }
  const view = createMarkdownView(root, { initialize: () => { starts++; return state } })
  try { view.update('<p>one</p>'); const first = root.firstChild; view.update('<p>two</p>'); view.update('<p>two</p>')
    assert.equal(root.firstChild, first); assert.equal(starts, 3); assert.equal(updates, 1)
  } finally { view.dispose(); root.remove() }
  assert.equal(stops, 3)
})

test('lifecycle registration reads each hook once and releases known setup on invalid hooks', () => {
  const root = container(); let reads = 0, stops = 0
  const view = createMarkdownView(root, { initialize: () => ({
    get dispose() { reads++; return () => stops++ },
    get update() { reads++; return () => {} },
  }) })
  view.update('<p>old</p>'); view.update('<p>new</p>'); assert.equal(reads, 2); view.dispose(); assert.equal(stops, 1)
  for (const throwing of [false, true]) {
    const invalid = createMarkdownView(root, { initialize: () => ({ dispose: () => stops++, get update() { if (throwing) throw new Error('getter failed'); return 1 } }) })
    assert.throws(() => invalid.update('<p>text</p>')); assert.equal(root.childNodes.length, 0); invalid.dispose()
  }
  assert.equal(stops, 3); root.remove()
})

test('nested patch opt-out and snapshot limits recover without retained trees', () => {
  const root = container(), view = createMarkdownView(root, { maxCachedHtmlLength: 30 })
  try {
    assert.equal(view.update('<p>alpha</p>').reason, 'html-limit'); assert.equal(view.metrics.cachedNodes, 0)
    view.update('<p>x</p>'); assert.equal(view.metrics.cachedNodes, 2); assert.ok(view.metrics.cachedHtmlCodeUnits <= 30)
  } finally { view.dispose() }
  const legacy = createMarkdownView(root, { patchChildren: false, maxCachedHtmlLength: 30 })
  try { assert.equal(legacy.update('<p>alpha</p>').mode, 'patch'); const first = root.firstChild; legacy.update('<p>beta</p>'); assert.notEqual(root.firstChild, first); assert.equal(legacy.metrics.cachedNodes, 0) }
  finally { legacy.dispose(); root.remove() }
})

test('deep iterative patches stay within node and depth limits', () => {
  const root = container(), view = createMarkdownView(root, { maxDepth: 401, maxNodes: 401 })
  try {
    const html = '<div>'.repeat(400) + 'old' + '</div>'.repeat(400)
    view.update(html); const first = root.firstChild; view.update(html.replace('old', 'new'))
    assert.equal(root.firstChild, first); assert.equal(root.textContent, 'new'); assert.equal(view.metrics.cachedNodes, 401)
    assert.equal(view.update('<div>' + html + '</div>').mode, 'replace'); assert.equal(view.metrics.cachedNodes, 0)
  } finally { view.dispose(); root.remove() }
})

for (const patchChildren of [false, true]) {
  test(`reused validation counts duplicate regions at the node limit, patchChildren=${patchChildren}`, () => {
    const root = container(), view = createMarkdownView(root, { maxNodes: 6, patchChildren })
    const region = '<p><em>text</em></p>'
    try {
      assert.equal(view.update(region).mode, 'patch')
      assert.equal(view.update(region.repeat(2)).mode, 'patch')
      assert.equal(root.innerHTML, region.repeat(2))
      assert.equal(view.update(region.repeat(3)).reason, 'node-limit')
      assert.equal(root.innerHTML, region.repeat(3))
      assert.equal(view.metrics.cachedRegions, 0)
      assert.equal(view.update(region).mode, 'patch')
    } finally { view.dispose(); root.remove() }
  })

  test(`changed regions retain their current node cost, patchChildren=${patchChildren}`, () => {
    const root = container(), view = createMarkdownView(root, { maxNodes: 6, patchChildren })
    const large = '<section><p>x</p><p>y</p></section>'
    try {
      view.update('<section>x</section>')
      assert.equal(view.update(large).mode, 'patch')
      assert.equal(view.update(large + '<hr>').mode, 'patch')
      assert.equal(view.update(large.repeat(2)).reason, 'node-limit')
      assert.equal(root.innerHTML, large.repeat(2))
      view.update(large)
      view.update('<section>x</section>')
      assert.equal(view.update('<section>x</section>'.repeat(3)).mode, 'patch')
    } finally { view.dispose(); root.remove() }
  })
}

test('cached validation does not authorize deeper nesting or new unsafe attributes', () => {
  const root = container(), view = createMarkdownView(root, { maxDepth: 2 })
  try {
    view.update('<p>text</p>')
    assert.equal(view.update('<p>text</p><p>other</p>').mode, 'patch')
    assert.equal(view.update('<p>text</p><div><p>text</p></div>').reason, 'depth-limit')
    view.update('<p>text</p>')
    assert.equal(view.update('<p>text</p><p onclick="void 0">other</p>').reason, 'unsupported-html')
    assert.equal(view.metrics.cachedNodes, 0)
    assert.equal(view.update('<p>text</p><p title="safe">other</p>').mode, 'patch')
  } finally { view.dispose(); root.remove() }
})

for (const operation of ['throw', 'dispose', 'reenter', 'ownership']) test(`lifecycle update ${operation} closes the view without retries`, () => {
  const root = container(); let view, starts = 0, stops = 0, updates = 0
  view = createMarkdownView(root, { initialize: () => { starts++; return {
    dispose: () => stops++, update: () => { updates++
      if (operation === 'throw') throw new Error('update failed')
      if (operation === 'dispose') view.dispose()
      if (operation === 'reenter') try { view.update('<p>nested</p>') } catch {}
      if (operation === 'ownership') root.append(document.createElement('p'))
    },
  } } })
  view.update('<p>old</p><p>last</p>'); assert.throws(() => view.update('<p>new</p><p>last</p>'))
  assert.equal(starts, 2); assert.equal(updates, 1); assert.equal(stops, 2); assert.equal(root.childNodes.length, 0); assert.equal(view.metrics.cachedNodes, 0)
  view.dispose(); root.remove()
})

test('changed descendant ownership replaces the region before any update callback', () => {
  const root = container(); let updates = 0, stops = 0
  const view = createMarkdownView(root, { initialize: () => ({ dispose: () => stops++, update: () => updates++ }) })
  try {
    view.update('<section><p>old</p></section>'); const first = root.firstChild; first.firstChild.replaceChildren('owned state')
    view.update('<section><p>new</p></section>'); assert.notEqual(root.firstChild, first); assert.equal(updates, 0); assert.equal(stops, 1)
    assert.equal(root.innerHTML, '<section><p>new</p></section>')
  } finally { view.dispose(); root.remove() }
})

test('cleanup cannot mutate another region selected for nested patching', () => {
  const root = container()
  const view = createMarkdownView(root, { initialize: node => ({
    dispose: () => { if (node.localName === 'aside') root.querySelector('p')?.replaceChildren('changed by cleanup') }, update() {},
  }) })
  view.update('<section><p>old</p></section><aside>remove</aside>')
  assert.throws(() => view.update('<section><p>new</p></section>'), /descendant ownership/)
  assert.equal(root.childNodes.length, 0); view.dispose(); root.remove()
})

test('embed-containing scopes retain replacement when embedded markup enters or leaves a container', () => {
  const root = container(), view = createMarkdownView(root, { initialize: () => ({ dispose() {}, update() { throw new Error('embed scope must not patch') } }) })
  try {
    view.update('<section><p>before</p></section>'); const before = root.firstChild
    view.update('<section><div class="embed" data-embed-consent>consent</div><p>before</p></section>'); assert.notEqual(root.firstChild, before)
    const embed = root.firstChild
    view.update('<section><div class="embed" data-embed-consent>consent</div><p>after</p></section>'); assert.notEqual(root.firstChild, embed)
    view.update('<section><p>after</p></section>')
  } finally { view.dispose(); root.remove() }
})

test('copy controller refresh rejects stale completions and resets custom labels', async () => {
  const root = container(); let resolveCopy
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise(resolve => { resolveCopy = resolve }) } })
  root.innerHTML = '<div data-copy-code-wrapper><button data-copy-code>Custom label</button><pre><code>old</code></pre></div>'
  const button = root.querySelector('button'), copy = initializeCopyCode({ root, resetDelay: 10_000 })
  try {
    button.click(); await flush(); copy.refresh(); resolveCopy(); await flush(); assert.equal(button.textContent, 'Custom label')
    button.click(); await flush(); resolveCopy(); await flush(); assert.equal(button.textContent, 'Copied!')
    button.click(); await flush(); resolveCopy(); await flush(); assert.equal(button.textContent, 'Copied!')
    copy.refresh(); assert.equal(button.textContent, 'Custom label')
    button.click(); await flush(); button.remove(); copy.refresh(); resolveCopy(); await flush(); assert.equal(button.textContent, 'Custom label')
  } finally { copy(); root.remove() }
})

test('presentation, word ranges, focus, diff, highlighting, and clean copying compose with nested patches', async () => {
  const root = container(), copied = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } })
  const parser = createParser({ sanitize: true, sanitizer: sanitizeHtml, plugins: [
    codePresentationPlugin({ injectStyles:false, highlight:{ grammars:[javascript], tokenize, renderToHTML, getThemeStylesheet, theme:githubDark, injectStyles:false, styleMode:'class' } }),
    copyCodePlugin({ injectStyles:false }),
  ] })
  const view = createMarkdownView(root, { initialize: node => { const copy = initializeCopyCode({root:node}); return {dispose:copy,update:copy.refresh} } })
  const source = '```js filename="example.js" focus="2" mark="2:7-11" diff\n- const value = 1;\n+ const value = 2;\n```'
  try {
    view.update(parser.parseDocument(source).html)
    const pre = root.querySelector('pre'), keyword = root.querySelector('code span'), button = root.querySelector('button')
    button.click(); await flush(); assert.equal(button.textContent, 'Copied!')
    const html = parser.parseDocument(source.replace('value = 2', 'value = 3')).html; view.update(html)
    assert.equal(root.innerHTML, expected(html)); assert.equal(root.querySelector('pre'), pre); assert.equal(root.querySelector('code span'), keyword); assert.equal(root.querySelector('button'), button)
    assert.equal(button.textContent, 'Copy'); button.click(); await flush(); assert.equal(copied.at(-1), 'const value = 3;\n')
  } finally { view.dispose(); root.remove() }
})

test('every streamed prefix matches complete highlighted and sanitized DOM output', () => {
  const root = container(), parser = createParser({ sanitize:true, sanitizer:sanitizeHtml, plugins:[codePresentationPlugin({injectStyles:false,highlight:{grammars:[javascript],tokenize,renderToHTML,injectStyles:false}})] })
  const view = createMarkdownView(root)
  const source = '# Guide\n\n> - ```js\n>   const value = `😀${1 + 2}`;\n>   /* incomplete then closed */\n>   ```\n\n| A | B |\n| - | - |\n| é | [ref] |\n\n[ref]: /next\n'
  try { for (let i = 0; i <= source.length; i++) { const html = parser.parseDocument(source.slice(0,i)).html; view.update(html); assert.equal(root.innerHTML, expected(html), String(i)) } }
  finally { view.dispose(); root.remove() }
})


const codeHtml = lines => '<h1>Stable</h1><pre class="highlight"><code class="language-js">' + lines.join('\n') + '</code></pre><p>Tail</p>'
const fastOptions = { patchChildren: false, maxCachedHtmlLength: 1, maxCodeBlockHtmlLength: 2_000_000 }
test('code staging retains unchanged syntax nodes and matches full parsing through 500 edits', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  let lines=Array.from({length:150},(_,i)=>'<span class="token">line '+i+'</span> &amp; 😀')
  try {
    view.update(codeHtml(lines)); const heading=root.firstChild,code=root.querySelector('code'),first=code.firstChild,tail=root.lastChild
    for(let i=0;i<500;i++) {
      const at=1+(i*43)%(lines.length-1)
      if(i%3===0)lines.splice(at,0,'<span><span>added</span> '+i+'</span>')
      else if(i%5===0&&lines.length>20)lines.splice(at,1)
      else lines[at]='<span class="token">changed '+i+'</span> &lt;tag&gt;'
      const html=codeHtml(lines),result=view.update(html)
      assert.equal(root.innerHTML,expected(html),String(i))
      assert.equal(result.mode,'patch'); assert.equal(root.firstChild,heading); assert.equal(root.lastChild,tail)
      assert.equal(root.querySelector('code'),code); assert.equal(code.firstChild,first)
    }
    assert.ok(view.metrics.cachedCodeBlockHtmlCodeUnits>1000)
    assert.equal(view.update(codeHtml(lines)).mode,'unchanged')
  }finally{view.dispose();assert.equal(view.metrics.cachedCodeBlockNodes,0);root.remove()}
})
test('code staging recovers from external DOM mutation, including pending observer records', async () => {
  const root=container(),view=createMarkdownView(root,fastOptions),html=codeHtml(['<span>kept</span>','tail'])
  try {
    for(const pending of [true,false]) {
      view.update(html);root.querySelector('span').textContent='outside'
      if(!pending)await Promise.resolve()
      assert.equal(view.update(html).reason,'external-mutation'); assert.equal(root.innerHTML,expected(html))
    }
  }finally{view.dispose();root.remove()}
})
test('code staging declines noncanonical markup, unsafe descendants, initializers, and cache limits', () => {
  for(const [options,first,next] of [
    [{maxCodeBlockHtmlLength:0},codeHtml(['one']),codeHtml(['two'])],
    [{maxCodeBlockHtmlLength:10},codeHtml(['one']),codeHtml(['two'])],
    [{maxNodes:1},codeHtml(['one']),codeHtml(['two'])],
    [{maxDepth:1},codeHtml(['one']),codeHtml(['two'])],
    [{maxRegions:1},codeHtml(['one']),codeHtml(['two'])],
    [{initialize:()=>()=>{}},codeHtml(['one']),codeHtml(['two'])],
    [{},codeHtml(['&#x22;one&#x22;']),codeHtml(['&#x22;two&#x22;'])],
    [{},codeHtml(['<b>one</b>']),codeHtml(['<b>two</b>'])],
    [{},codeHtml(['<span is="test">one</span>']),codeHtml(['<span is="test">two</span>'])],
    [{},codeHtml(['<span onclick="void 0">one</span>']),codeHtml(['<span onclick="void 0">two</span>'])],
  ]) {
    const root=container(),view=createMarkdownView(root,{...fastOptions,...options})
    try {view.update(first); assert.equal(view.metrics.cachedCodeBlockNodes||0,0);view.update(next);assert.equal(root.innerHTML,expected(next))}
    finally{view.dispose();root.remove()}
  }
})
test('code staging bounds new nodes and handles changed shells or malformed fragments', () => {
  const root=container(),view=createMarkdownView(root,{...fastOptions,maxNodes:10})
  try{
    for(const html of [codeHtml(['<span>small</span>']),codeHtml(Array(20).fill('<span>x</span>')),codeHtml(['back']),
      codeHtml(['back']).replace('Stable','Changed'),codeHtml(['<span>open']),codeHtml(['closed']),
      codeHtml(['<span>x</span><span>y</span>']),codeHtml(['<span><span>joined</span></span>']),codeHtml([''])]) {
      view.update(html);assert.equal(root.innerHTML,expected(html))
      assert.ok(view.metrics.cachedCodeBlockNodes<=10)
    }
  }finally{view.dispose();root.remove()}
})

test('code staging preserves escaped quote offsets without decoding markup as structure', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  try {
    view.update(codeHtml(['<span>&quot;quoted&#39;</span>','<span>&amp;quot; &lt;img&gt;</span>','tail']))
    const code=root.querySelector('code'),first=code.firstChild
    for(const tail of ['new','<span>&quot;changed&#39;</span>','<span>"raw quotes"</span>']) {
      const html=codeHtml(['<span>&quot;quoted&#39;</span>','<span>&amp;quot; &lt;img&gt;</span>',tail])
      assert.equal(view.update(html).mode,'patch');assert.equal(root.innerHTML,expected(html))
      assert.equal(root.querySelector('code'),code);assert.equal(code.firstChild,first);assert.equal(root.querySelector('img'),null)
    }
  }finally{view.dispose();root.remove()}
})

test('bounded code comparisons preserve exact output around slice and Unicode boundaries', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  const body='a'.repeat(1023)+'😀'+'b'.repeat(2050), wrap=text=>codeHtml(['<span>kept</span>',text,'<span>tail</span>'])
  try{
    view.update(wrap(body));const code=root.querySelector('code'),first=code.firstChild,tail=code.lastChild
    for(const at of [0,1,1022,1023,1024,1025,2047,2048,body.length-1]){
      for(const next of [body.slice(0,at)+'é'+body.slice(at),body.slice(0,at)+body.slice(at+1),body]){
        const html=wrap(next)
        assert.equal(view.update(html).mode,'patch');assert.equal(root.innerHTML,expected(html))
        assert.equal(root.querySelector('code'),code);assert.equal(code.firstChild,first);assert.equal(code.lastChild,tail)
      }
    }
  }finally{view.dispose();root.remove()}
})
test('framework-owned root attributes do not invalidate code staging or ordinary region reuse', async () => {
  const root=container(),view=createMarkdownView(root,{...fastOptions,maxCachedHtmlLength:32000})
  try {
    view.update(codeHtml(['<span>first</span>']));const heading=root.firstChild,code=root.querySelector('code')
    root.setAttribute('aria-busy','true');await Promise.resolve()
    view.update(codeHtml(['<span>first</span>','more']))
    assert.equal(root.firstChild,heading);assert.equal(root.querySelector('code'),code)
    root.dataset.status='ready'
    assert.equal(view.update(codeHtml(['<span>first</span>','more'])).mode,'unchanged')
    const next=codeHtml(['<span>first</span>','more']).replace('<p>Tail</p>','<p>Changed tail</p>')
    view.update(next);assert.equal(root.innerHTML,expected(next))
  }finally{view.dispose();root.remove()}
})

test('code staging respects whole-document node, depth, and unsupported-region limits', () => {
  for(const [options,html] of [
    [{maxNodes:8},'<p>a</p><p>b</p><p>c</p>'+codeHtml(['<span>x</span>'])],
    [{maxDepth:4},'<blockquote><div>'+codeHtml(['<span>x</span>'])+'</div></blockquote>'],
    [{},'<style>p{color:red}</style>'+codeHtml(['<span>x</span>'])],
    [{},'<x-code-test></x-code-test>'+codeHtml(['<span>x</span>'])],
    [{},'<svg></svg>'+codeHtml(['<span>x</span>'])],
  ]) {
    const root=container(),view=createMarkdownView(root,{...fastOptions,...options})
    try{view.update(html);assert.equal(view.metrics.cachedCodeBlockNodes,0);view.update(html.replace('>x<','>y<'));assert.equal(root.innerHTML,expected(html.replace('>x<','>y<')))}
    finally{view.dispose();root.remove()}
  }
})

test('changing containers retain code snapshots instead of rebuilding syntax entries', () => {
  const root=container(),view=createMarkdownView(root,{...fastOptions,patchChildren:true})
  const body=Array.from({length:200},(_,i)=>'<span class="token">line '+i+'</span>').join('\n')
  const html=i=>'<h1>Revision '+i+'</h1><blockquote><ul><li>'+(i%2?'<p>Loose</p>':'Tight')+'</li></ul><pre><code>'+body+'</code></pre></blockquote><table><tbody><tr><td>'+i+'</td></tr></tbody></table>'
  const clone=window.Element.prototype.cloneNode;let syntaxClones=0
  try {
    view.update(html(0));const code=root.querySelector('code'),first=code.firstChild,quote=root.querySelector('blockquote'),table=root.querySelector('table')
    window.Element.prototype.cloneNode=function(...args){if(this.localName==='span')syntaxClones++;return clone.apply(this,args)}
    for(let i=1;i<=20;i++){
      view.update(html(i));assert.equal(root.innerHTML,expected(html(i)))
      assert.equal(root.querySelector('code'),code);assert.equal(code.firstChild,first)
      assert.equal(root.querySelector('blockquote'),quote);assert.equal(root.querySelector('table'),table)
    }
    assert.equal(syntaxClones,0,'unchanged code must not reconstruct its syntax index')
  }finally{window.Element.prototype.cloneNode=clone;view.dispose();root.remove()}
})
test('separate code blocks retain unchanged nodes during local edits and streaming', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  const block=(name,tail)=>'<section><h2>'+name+'</h2><pre><code><span>'+name+'</span> '+tail+'</code></pre></section>'
  try {
    view.update(block('A','one')+block('B','two')+block('C','three'))
    const codes=[...root.querySelectorAll('code')],first=codes.map(code=>code.firstChild)
    for(let i=0;i<100;i++){
      const html=block('A','one')+block('B','edit '+i)+block('C','three'+'.'.repeat(i))
      assert.equal(view.update(html).mode,'patch');assert.equal(root.innerHTML,expected(html))
      assert.deepEqual([...root.querySelectorAll('code')],codes)
      codes.forEach((code,j)=>assert.equal(code.firstChild,first[j]))
    }
  }finally{view.dispose();root.remove()}
})

test('code blocks survive insertion, removal, reordering, and new surrounding containers', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  const block=id=>'<pre><code><span>'+id+'</span></code></pre>'
  try {
    view.update(block('A')+block('B')+block('C'))
    const codes=new Map([...root.querySelectorAll('code')].map(code=>[code.textContent,code]))
    for(const html of [block('C')+block('A')+block('B'), '<section>'+block('A')+'</section>'+block('B')+block('C'),
      block('D')+block('A')+block('B')+block('C'), block('A')+block('C'), '<blockquote><div>'+block('C')+'</div></blockquote>'+block('A')]){
      view.update(html);assert.equal(root.innerHTML,expected(html))
      for(const code of root.querySelectorAll('code'))if(codes.has(code.textContent))assert.equal(code,codes.get(code.textContent))
    }
    const html=block('A')+block('A')+block('C')
    view.update(html);assert.equal(root.innerHTML,expected(html));assert.equal(new Set(root.querySelectorAll('code')).size,3)
    view.update(block('A')+block('C'));assert.equal(root.innerHTML,expected(block('A')+block('C')))
  }finally{view.dispose();root.remove()}
})
test('a growing single block transitions to multiple blocks without losing its first code node', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  const block=body=>'<pre><code><span>'+body+'</span></code></pre>'
  try{
    view.update(block('A'));const first=root.querySelector('code'),syntax=first.firstChild
    for(const html of [block('A')+block('B'),block('A')+block('B changed'),block('A'),block('A grown')]){
      assert.equal(view.update(html).mode,'patch');assert.equal(root.innerHTML,expected(html))
      assert.equal(root.querySelector('code'),first)
      if(!html.includes('A grown'))assert.equal(first.firstChild,syntax)
    }
  }finally{view.dispose();root.remove()}
})
test('separate code snapshots count complete document nodes and nesting before any live patch', () => {
  const block=body=>'<pre><code>'+body+'</code></pre>',base=block('a')+block('b')
  for(const [options,cached] of [[{maxNodes:6,maxDepth:3,maxRegions:2},6],[{maxNodes:5},0],[{maxDepth:2},0],[{maxRegions:1},0]]){
    const root=container(),view=createMarkdownView(root,{...fastOptions,...options})
    try{view.update(base);assert.equal(view.metrics.cachedCodeBlockNodes,cached);view.update(block('c')+block('d'));assert.equal(root.innerHTML,expected(block('c')+block('d')))}
    finally{view.dispose();root.remove()}
  }
  const root=container(),view=createMarkdownView(root,{...fastOptions,maxNodes:6})
  const observer=new window.MutationObserver(()=>{})
  try{
    view.update(base);observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true})
    const html=block('changed')+block('<span>over limit</span>')
    assert.equal(view.update(html).mode,'replace');assert.equal(root.innerHTML,expected(html))
    assert.ok(observer.takeRecords().every(record=>record.target===root),'no code fragment mutates before whole-document limits pass')
    assert.equal(view.metrics.cachedCodeBlockNodes,0)
    view.update(base);assert.equal(view.metrics.cachedCodeBlockNodes,6)
    const deep='<blockquote>'+base+'</blockquote>'
    view.update(deep);assert.equal(root.innerHTML,expected(deep));assert.equal(view.metrics.cachedCodeBlockNodes,0)
  }finally{observer.disconnect();view.dispose();root.remove()}
})
test('code and container staging preserve root attributes and invalidate all owned descendant mutations', async () => {
  const root=container(),view=createMarkdownView(root,{...fastOptions,patchChildren:true})
  const html='<section><h2>Title</h2><pre><code><span>A</span></code></pre><pre><code>B</code></pre></section>'
  try{
    for(const mutate of [()=>{root.querySelector('h2').textContent='external'},()=>{root.querySelector('span').setAttribute('class','outside')},()=>{root.querySelector('code').append('external')},()=>{root.querySelector('pre').remove()}]){
      view.update(html);mutate();await Promise.resolve()
      assert.equal(view.update(html).reason,'external-mutation');assert.equal(root.innerHTML,expected(html))
    }
    const section=root.firstChild,codes=[...root.querySelectorAll('code')]
    root.setAttribute('aria-busy','true');root.className='framework'
    const next=html.replace('Title','Changed')
    view.update(next);assert.equal(root.firstChild,section);assert.deepEqual([...root.querySelectorAll('code')],codes)
    assert.equal(root.className,'framework');assert.equal(root.getAttribute('aria-busy'),'true')
  }finally{view.dispose();root.remove()}
})
test('all generated edits and streamed container prefixes match complete highlighted sanitized DOM', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  const parser=createParser({sanitize:true,sanitizer:sanitizeHtml,plugins:[codePresentationPlugin({injectStyles:false,highlight:{grammars:[javascript],tokenize,renderToHTML,injectStyles:false}})]})
  const source='# Guide\n\n> - ```js\n>   const x = `😀${1 + 2}`;\n>   ```\n\n```js\nconst other = /a+/g;\n```\n\n| A | B |\n| - | - |\n| é | value |\n'
  try{
    for(let i=0;i<=source.length;i++){const html=parser.parseDocument(source.slice(0,i)).html;view.update(html);assert.equal(root.innerHTML,expected(html),String(i))}
    let seed=12345
    for(let i=0;i<300;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0
      const blocks=Array.from({length:1+seed%5},(_,j)=>'<pre><code><span class="token">'+(seed+j)+'</span> &amp; 😀 é</code></pre>').join(i%2?'<p>Between</p>':'')
      const html=(i%3?'<blockquote><ul><li>Item '+i+'</li></ul>'+blocks+'</blockquote>':'<section>'+blocks+'</section>')+'<table><tbody><tr><td>'+i+'</td></tr></tbody></table>'
      view.update(html);assert.equal(root.innerHTML,expected(html),String(i));assert.ok(view.metrics.cachedCodeBlockNodes<=50000)
    }
  }finally{view.dispose();root.remove()}
})

test('disabled descendant patches still reuse code without changing ordinary container ownership', () => {
  const root=container(),view=createMarkdownView(root,fastOptions)
  const html='<blockquote><p>Before</p><pre><code><span>kept</span></code></pre></blockquote>'
  try{
    view.update(html);const quote=root.firstChild,code=root.querySelector('code'),span=code.firstChild
    view.update(html.replace('Before','After'))
    assert.notEqual(root.firstChild,quote);assert.equal(root.querySelector('code'),code);assert.equal(code.firstChild,span)
    assert.equal(root.innerHTML,expected(html.replace('Before','After')))
  }finally{view.dispose();root.remove()}
})

for (const styleMode of ['inline', 'class']) test(`source line layout retains text, copy output, and unchanged DOM rows in ${styleMode} mode`, async () => {
  const root = container(), view = createMarkdownView(root, { maxCodeBlockHtmlLength: 100_000 })
  const source = 'const value = `😀\n\n日本語`;\n\n'
  const config = { allowedTags: DEFAULT_ALLOWED_TAGS, allowedAttributes: DEFAULT_ALLOWED_ATTRIBUTES, allowStyle: true }
  const html = code => sanitizeHtml(renderToHTML(tokenize(code, javascript), { theme: githubDark, styleMode, wrapLines: 'source' }), config)
  try {
    for (let end = 0; end <= source.length; end++) {
      const code = source.slice(0, end), output = html(code)
      view.update(output)
      assert.equal(root.innerHTML, expected(output))
      assert.equal(root.querySelector('code').textContent, code)
    }
    const first = root.querySelector('.neo-hl-line-source')
    view.update(html(source + 'const next = 2;\n'))
    assert.equal(root.querySelector('.neo-hl-line-source'), first)
    assert.ok(view.metrics.cachedCodeBlockNodes < 50_000)
    view.dispose()
    root.innerHTML = '<div data-copy-code-wrapper><button data-copy-code>Copy</button>' + html(source) + '</div>'
    const copies = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => copies.push(text) } })
    const release = initializeCopyCode({ root })
    try {
      root.querySelector('button').click(); await flush()
      assert.deepEqual(copies, [source])
      root.querySelectorAll('.neo-hl-line-source')[1].setAttribute('data-copy-code-exclude', 'true')
      root.querySelector('button').click(); await flush()
      assert.equal(copies[1], 'const value = `😀\n日本語`;\n\n')
    } finally { release() }
  } finally { view.dispose(); root.remove() }
})
