import { Fragment, type ReactElement } from 'react'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CodePen,
  CodeSandbox,
  Loom,
  Tweet,
  Vimeo,
  YouTube,
} from '../../src/plugins/embeds/react.js'

interface ObserverHarness {
  enterViewport(): void
  disconnect: ReturnType<typeof vi.fn>
}

interface DocumentHarness {
  document: Pick<Document, 'createElement' | 'head' | 'querySelector'>
  appendedScripts: HTMLScriptElement[]
}

const REACT_TEST_RENDERER_WARNING =
  'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer'
const originalConsoleError = console.error

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] === REACT_TEST_RENDERER_WARNING) return
    originalConsoleError(...args)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined

  await act(async () => {
    renderer = create(element, {
      createNodeMock: () => ({ nodeType: 1 }),
    })
  })

  return renderer as ReactTestRenderer
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount())
}

function iframe(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType('iframe')
}

function installIntersectionObserver(): ObserverHarness {
  let callback: IntersectionObserverCallback | undefined
  let observedInstance: MockIntersectionObserver | undefined
  const disconnect = vi.fn()

  class MockIntersectionObserver {
    readonly root = null
    readonly rootMargin = '200px'
    readonly thresholds = [0]

    constructor(nextCallback: IntersectionObserverCallback) {
      callback = nextCallback
      observedInstance = this
    }

    disconnect = disconnect
    observe = vi.fn()
    takeRecords = vi.fn(() => [])
    unobserve = vi.fn()
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

  return {
    disconnect,
    enterViewport() {
      callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observedInstance as unknown as IntersectionObserver
      )
    },
  }
}

function installDocument(existingScript?: HTMLScriptElement): DocumentHarness {
  const appendedScripts: HTMLScriptElement[] = []
  let currentScript = existingScript
  const head = {
    appendChild: vi.fn((script: HTMLScriptElement) => {
      appendedScripts.push(script)
      currentScript = script
      return script
    }),
  }
  const document = {
    createElement: vi.fn(() => {
      const script = new EventTarget() as HTMLScriptElement
      Object.assign(script, { async: false, src: '' })
      return script
    }),
    head,
    querySelector: vi.fn(() => currentScript ?? null),
  }

  vi.stubGlobal('document', document)
  return { document: document as unknown as DocumentHarness['document'], appendedScripts }
}

describe('React iframe embeds', () => {
  it('renders YouTube privacy, loading, title, and class options', async () => {
    const renderer = await render(
      <YouTube
        id="video-id"
        title="Demo video"
        privacyEnhanced={false}
        lazyLoad={false}
        className="wide"
      />
    )

    expect(renderer.root.findByType('div').props.className).toBe(
      'embed embed-youtube wide'
    )
    expect(iframe(renderer).props).toMatchObject({
      src: 'https://www.youtube.com/embed/video-id',
      title: 'Demo video',
      loading: undefined,
      allowFullScreen: true,
    })

    await unmount(renderer)
  })

  it('defers Vimeo until it enters the viewport', async () => {
    const observer = installIntersectionObserver()
    const renderer = await render(<Vimeo id="53373707" />)

    expect(renderer.root.findAllByType('iframe')).toHaveLength(0)

    await act(async () => observer.enterViewport())

    expect(iframe(renderer).props).toMatchObject({
      src: 'https://player.vimeo.com/video/53373707?dnt=1',
      title: 'Vimeo video',
      allowFullScreen: true,
    })
    expect(observer.disconnect).toHaveBeenCalled()

    await unmount(renderer)
  })

  it('can render Vimeo immediately without Do Not Track', async () => {
    const renderer = await render(
      <Vimeo id="42" title="Vimeo demo" dnt={false} lazyLoad={false} className="wide" />
    )

    expect(renderer.root.findByType('div').props.className).toBe('embed embed-vimeo wide')
    expect(iframe(renderer).props.src).toBe('https://player.vimeo.com/video/42')

    await unmount(renderer)
  })

  it.each([
    {
      name: 'CodeSandbox',
      element: <CodeSandbox id="new" title="Sandbox demo" className="wide" />,
      className: 'embed embed-codesandbox wide',
      src: 'https://codesandbox.io/embed/new?fontsize=14&hidenavigation=1&theme=dark',
      title: 'Sandbox demo',
    },
    {
      name: 'CodePen',
      element: <CodePen id="abc" user="neo" defaultTab="js,result" />,
      className: 'embed embed-codepen',
      src: 'https://codepen.io/neo/embed/abc?default-tab=js,result',
      title: 'CodePen',
    },
    {
      name: 'Loom',
      element: <Loom id="recording" />,
      className: 'embed embed-loom',
      src: 'https://www.loom.com/embed/recording',
      title: 'Loom video',
    },
  ])('renders the $name component', async ({ element, className, src, title }) => {
    const renderer = await render(element)

    expect(renderer.root.findByType('div').props.className).toBe(className)
    expect(iframe(renderer).props).toMatchObject({
      src,
      title,
      loading: 'lazy',
    })

    await unmount(renderer)
  })

  it('uses a least-privilege CodeSandbox iframe policy', async () => {
    const renderer = await render(<CodeSandbox id="safe" />)
    const props = iframe(renderer).props

    expect(props.sandbox).toBe('allow-same-origin allow-scripts')
    expect(props.allow).toBeUndefined()

    await unmount(renderer)
  })

  it('uses a least-privilege CodePen iframe policy', async () => {
    const renderer = await render(<CodePen id="safe" user="neo" />)
    const props = iframe(renderer).props

    expect(props.sandbox).toBe('allow-same-origin allow-scripts')

    await unmount(renderer)
  })
})

describe('Tweet', () => {
  it('renders embed attributes and loads the widget after the script is ready', async () => {
    const { appendedScripts } = installDocument()
    const load = vi.fn()
    vi.stubGlobal('window', { twttr: { widgets: { load } } })
    const renderer = await render(
      <Tweet id="1234567890" dnt={false} theme="dark" className="centered" />
    )

    const blockquote = renderer.root.findByType('blockquote')
    expect(renderer.root.findByType('div').props.className).toBe(
      'embed embed-twitter centered'
    )
    expect(blockquote.props).toMatchObject({
      className: 'twitter-tweet',
      'data-dnt': undefined,
      'data-theme': 'dark',
    })
    expect(blockquote.findByType('a').props.href).toBe(
      'https://twitter.com/i/status/1234567890'
    )
    expect(appendedScripts).toHaveLength(1)

    await act(async () => {
      appendedScripts[0]?.dispatchEvent(new Event('load'))
    })

    expect(load).toHaveBeenCalledOnce()
    await unmount(renderer)
  })

  it('deduplicates the Twitter script for concurrent embeds', async () => {
    const { appendedScripts, document } = installDocument()
    const load = vi.fn()
    vi.stubGlobal('window', { twttr: { widgets: { load } } })
    const renderer = await render(
      <Fragment>
        <Tweet id="1" />
        <Tweet id="2" />
      </Fragment>
    )

    expect(document.createElement).toHaveBeenCalledOnce()
    expect(appendedScripts).toHaveLength(1)

    await act(async () => {
      appendedScripts[0]?.dispatchEvent(new Event('load'))
    })

    expect(load).toHaveBeenCalledTimes(2)
    await unmount(renderer)
  })

  it('cancels polling and removes listeners on unmount', async () => {
    vi.useFakeTimers()
    const existingScript = new EventTarget() as HTMLScriptElement
    const removeEventListener = vi.spyOn(existingScript, 'removeEventListener')
    installDocument(existingScript)
    vi.stubGlobal('window', {})
    const renderer = await render(<Tweet id="1" />)

    expect(vi.getTimerCount()).toBe(1)
    await unmount(renderer)

    expect(vi.getTimerCount()).toBe(0)
    expect(removeEventListener).toHaveBeenCalled()
  })

  it('shares one readiness poll across concurrent Tweet components', async () => {
    vi.useFakeTimers()
    installDocument(new EventTarget() as HTMLScriptElement)
    vi.stubGlobal('window', {})
    const renderer = await render(
      <Fragment>
        {Array.from({ length: 100 }, (_, index) => <Tweet id={String(index)} key={index} />)}
      </Fragment>
    )

    expect(vi.getTimerCount()).toBe(1)
    await act(async () => vi.runAllTimers())
    expect(vi.getTimerCount()).toBe(0)
    await unmount(renderer)
    expect(vi.getTimerCount()).toBe(0)
  })
})
