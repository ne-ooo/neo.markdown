import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Emphasis Nesting Edge Cases (Phase 2)', () => {
  it('should parse bold inside italic with asterisks', () => {
    const result = parse('*italic **and bold***')
    // Should render as: <p><em>italic <strong>and bold</strong></em></p>
    expect(result).toContain('<em>')
    expect(result).toContain('<strong>')
    expect(result).toContain('italic')
    expect(result).toContain('and bold')
  })

  it('should parse italic inside bold with asterisks', () => {
    // Phase 3: Fixed! Triple *** now handled correctly
    const result = parse('**bold *and italic***')
    // Should render as: <p><strong>bold <em>and italic</em></strong></p>
    expect(result).toContain('<strong>')
    expect(result).toContain('<em>')
    expect(result).toContain('bold')
    expect(result).toContain('and italic')
  })

  it('should parse bold inside italic with underscores', () => {
    const result = parse('_italic __and bold___')
    // Should render as: <p><em>italic <strong>and bold</strong></em></p>
    expect(result).toContain('<em>')
    expect(result).toContain('<strong>')
    expect(result).toContain('italic')
    expect(result).toContain('and bold')
  })

  it('should parse italic inside bold with underscores', () => {
    // Phase 3: Fixed! Triple ___ now handled correctly
    const result = parse('__bold _and italic___')
    // Should render as: <p><strong>bold <em>and italic</em></strong></p>
    expect(result).toContain('<strong>')
    expect(result).toContain('<em>')
    expect(result).toContain('bold')
    expect(result).toContain('and italic')
  })

  it('should handle mixed emphasis markers', () => {
    // Phase 3: Fixed! Now correctly parses **bold** inside *...*
    const result = parse('*italic **bold** italic*')
    expect(result).toContain('<em>')
    expect(result).toContain('<strong>')
    expect(result).toContain('italic')
    expect(result).toContain('bold')
  })

  it('should handle triple emphasis (bold + italic)', () => {
    // Phase 3: Fixed! Triple *** now correctly creates nested bold+italic
    const result = parse('***bold and italic***')
    // This is a tricky case - could be interpreted as bold+italic
    expect(result).toContain('<strong>')
    expect(result).toContain('<em>')
    expect(result).toContain('bold and italic')
  })
})
