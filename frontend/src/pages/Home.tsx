/* The public home page. Visual idea: a lens. Returns are a blur until ReturnLens brings one cause into focus. */
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LensRings, Slope, WordChips, ink } from '../components/charts'
import Icon, { type IconName } from '../components/Icon'
import { LiveDot, Logo, ThemeSwitch } from '../components/ui'
import { useAuth } from '../lib/auth'
import { cx } from '../lib/format'

const FEED: [string, string, string][] = [
  ['RET-20734', 'Left earbud stopped charging after 4 days', 'rose'],
  ['REV-8812', 'Box was crushed, one mug cracked', 'butter'],
  ['RET-20741', 'Runs a full size small compared to my old pair', 'blush'],
  ['RET-20755', 'Right bud dead, the charging contacts don’t connect', 'rose'],
  ['REV-8830', 'Not the green shown in the photos', 'mist'],
  ['RET-20760', 'Changed my mind', 'sky'],
  ['RET-20768', 'One earbud has no sound at all', 'rose'],
  ['RET-20771', 'Lamp arrived without the screws', 'mist'],
  ['REV-8841', 'Vase arrived shattered, box soaked', 'sky'],
  ['RET-20779', 'Left bud won’t charge out of the box', 'rose'],
]

const SOURCES: [string, IconName][] = [
  ['Order exports', 'list'], ['Return reports', 'refresh'], ['Excel sheets', 'file'], ['Customer reviews', 'chat'],
  ['Shipping records', 'truck'], ['QC reports (PDF, Word)', 'flask'], ['Change logs', 'history'], ['Product listings', 'tag'],
]

const STEPS: { title: string; body: string; tone: string; blur: number }[] = [
  { title: 'Upload', body: 'Orders, returns, reviews, shipments, batches and QC reports, in whatever columns you have.', tone: 'mist', blur: 7 },
  { title: 'Group', body: 'Complaints that mean the same thing become one group, whatever the wording.', tone: 'butter', blur: 4.5 },
  { title: 'Trace', body: 'Each group is tested against batch, supplier, carrier and recent changes.', tone: 'blush', blur: 2.5 },
  { title: 'Price it', body: 'Refunds, shipping, replacements and write-offs, recorded kept apart from estimated.', tone: 'sky', blur: 1 },
  { title: 'Fix & check', body: 'Approve a fix, record when it went live, and see if returns really fell.', tone: 'mint', blur: 0 },
]

export default function Home() {
  const { user } = useAuth()
  const start = user ? '/app' : '/register'

  return (
    <div className="relative overflow-hidden bg-bg text-[15px]">
      <LensRings className="-right-[240px] -top-[300px]" size={820} />

      <header className="relative mx-auto flex max-w-[1200px] flex-wrap items-center gap-6 px-6 py-5">
        <Logo size={24} />
        <nav aria-label="Primary" className="hidden gap-6 text-sm sm:flex">
          <a href="#how" className="text-muted transition hover:text-text">How it works</a>
          <a href="#finds" className="text-muted transition hover:text-text">What it finds</a>
          <a href="#control" className="text-muted transition hover:text-text">Fix &amp; verify</a>
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <ThemeSwitch />
          {user
            ? <Link to="/app" className="btn h-[34px] rounded-[9px] px-3.5 text-sm">Open app</Link>
            : <Link to="/login" className="btn h-[34px] rounded-[9px] px-3.5 text-sm">Sign in</Link>}
        </div>
      </header>

      <section className="relative mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-6 pb-10 pt-14 sm:pt-16">
        <div className="min-w-0 flex-[1_1_460px]">
          <div className="anim-rise inline-flex items-center gap-2 rounded-full border border-line/[0.1] py-[5px] pl-1.5 pr-3 text-[13px] text-muted">
            <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] font-semibold text-onpastel">NEW</span>
            Returns &amp; refund root-cause agent
          </div>
          <h1 className="anim-rise mt-6 text-[44px] font-semibold leading-[1.04] tracking-[-0.04em] text-strong sm:text-[56px]" style={{ animationDelay: '.08s' }}>
            See <span className="marker px-1">why</span> products come back, not just how many.
          </h1>
          <p className="anim-rise mt-5 max-w-[520px] text-lg leading-relaxed text-muted" style={{ animationDelay: '.16s' }}>
            Drop in orders, returns and reviews. ReturnLens groups the complaints, traces them to a batch, supplier, carrier or listing
            change, shows what they cost, and checks whether your fix actually worked.
          </p>
          <div className="anim-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: '.24s' }}>
            <Link to={start} className="btn-primary h-11 rounded-[10px] px-[18px] text-[15px]">Try it with the sample store <Icon name="arrowRight" size={16} /></Link>
            <a href="#how" className="btn h-11 rounded-[10px] px-[18px] text-[15px]">See how it works</a>
          </div>
          <div className="anim-rise mt-7 flex flex-wrap gap-4 text-[13px] text-faint" style={{ animationDelay: '.32s' }}>
            <span>CSV, Excel, Word or PDF</span><span aria-hidden="true">·</span><span>Evidence behind every claim</span><span aria-hidden="true">·</span><span>Never “confirmed” without a record</span>
          </div>
        </div>
        <LensDemo />
      </section>

      <section className="relative mx-auto max-w-[1200px] px-6 pt-20" aria-label="Supported data">
        <div className="mb-4 text-[13px] text-faint">Works with what you already have</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {SOURCES.map(([label, icon], i) => (
            <div key={label} className="anim-sharpen flex items-center gap-2.5 rounded-xl border border-line/[0.08] bg-panel px-3.5 py-3 text-sm text-body" style={{ animationDelay: `${0.2 + i * 0.12}s` }}>
              <Icon name={icon} size={15} className="text-faint" />{label}
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="relative mx-auto max-w-[1200px] px-6 pt-28">
        <div className="max-w-[640px]">
          <div className="font-mono text-[13px] text-sky-ink">HOW IT WORKS</div>
          <h2 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-strong sm:text-[40px]">From a blur of returns to one clear cause</h2>
          <p className="mt-3.5 text-[17px] leading-relaxed text-muted">Five steps, each one sharper than the last. You upload; it does the rest and shows its working.</p>
        </div>
        <ol className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-[38px] hidden border-t-2 border-dashed border-line/[0.12] lg:block" />
          {STEPS.map((s, i) => (
            <li key={s.title} className="card card-hover relative flex flex-col gap-3 rounded-2xl p-5">
              <span className="relative inline-flex h-[56px] w-[56px]">
                <span className="absolute inset-0 rounded-full" style={{ background: `rgb(var(--${s.tone}))`, filter: `blur(${s.blur}px)` }} />
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[13px] text-onpastel" style={{ filter: `blur(${s.blur / 3}px)` }}>0{i + 1}</span>
              </span>
              <div className="text-base font-medium">{s.title}</div>
              <div className="text-sm leading-relaxed text-muted">{s.body}</div>
            </li>
          ))}
        </ol>
      </section>

      <section id="finds" className="relative mx-auto max-w-[1200px] px-6 pt-28">
        <div className="max-w-[640px]">
          <div className="font-mono text-[13px] text-blush-ink">WHAT IT FINDS</div>
          <h2 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-strong sm:text-[40px]">The patterns hiding in your returns</h2>
          <p className="mt-3.5 text-[17px] leading-relaxed text-muted">A return reason says “damaged”. ReturnLens asks: damaged where, from which batch, by which carrier, since when?</p>
        </div>
        <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FindCard title="A bad manufacturing batch" body="One batch returning far more than the product’s other batches, checked against inspection reports.">
            <svg viewBox="0 0 220 90" width="100%" aria-hidden="true">
              <rect x="20" y="28" width="56" height="34" rx="10" fill={ink('mint', 0.12)} />
              {[28, 38, 46, 56, 66].map((x, i) => <circle key={x} cx={x} cy={45 + ((i % 3) - 1) * 9} r="5.5" fill={ink('sky', 0.85)} />)}
              <circle cx="180" cy="45" r="13" fill="none" stroke={ink('rose')} strokeWidth="1.5" className="anim-ring" />
              <circle cx="180" cy="45" r="9" fill={ink('rose')} />
              <text x="180" y="20" textAnchor="middle" fontSize="11" fill="rgb(var(--text))" fontFamily="Geist Mono">16%</text>
            </svg>
          </FindCard>
          <FindCard title="Packaging that gives way" body="Damage that jumps right after a packaging change, across every carrier.">
            <svg viewBox="0 0 220 90" width="100%" aria-hidden="true">
              <line x1="110" y1="6" x2="110" y2="84" stroke={ink('sky')} strokeDasharray="3 4" />
              <text x="114" y="16" fontSize="10" fill={ink('sky')}>new box</text>
              {[70, 68, 72, 69, 71, 40, 30, 27, 25, 24].map((y, i) => <circle key={i} cx={14 + i * 21} cy={y} r="4" fill={i > 4 ? ink('butter') : ink('butter', 0.4)} />)}
              <polyline points={[70, 68, 72, 69, 71, 40, 30, 27, 25, 24].map((y, i) => `${14 + i * 21},${y}`).join(' ')} fill="none" stroke={ink('butter', 0.5)} strokeWidth="1.5" />
            </svg>
          </FindCard>
          <FindCard title="A carrier that breaks things" body="Transit damage concentrated in one carrier, confirmed by its own damage scans.">
            <div className="w-full px-3 text-xs">
              {[['ParcelPro', 0.9, 3.5, true], ['QuickShip', 0.8, 0.9, false], ['EcoFreight', 0.7, 0.7, false]].map(([n, a, b, up]) => (
                <div key={n as string} className="grid grid-cols-[72px_1fr] items-center gap-2 py-1.5">
                  <span className="text-muted">{n as string}</span>
                  <span className="relative h-3">
                    <span className="absolute inset-x-0 top-[5px] h-[2px] rounded bg-line/[0.07]" />
                    <span className="absolute top-0 box-border h-3 w-3 -translate-x-1/2 rounded-full border-2 border-muted bg-panel" style={{ left: `${((a as number) / 4) * 100}%` }} />
                    <span className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full" style={{ left: `${((b as number) / 4) * 100}%`, background: up ? ink('rose') : ink('mint') }} />
                  </span>
                </div>
              ))}
            </div>
          </FindCard>
          <FindCard title="A listing that misleads" body="“Not as described” climbing after new photos or copy went live.">
            <div className="px-3"><WordChips words={[{ text: 'not the colour shown', count: 31 }, { text: 'looks different', count: 18 }, { text: 'not sage', count: 9 }, { text: 'thinner fabric', count: 6 }]} /></div>
          </FindCard>
        </div>
      </section>

      <section className="relative mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-6 pt-28">
        <div className="min-w-0 flex-[1_1_380px]">
          <div className="font-mono text-[13px] text-mist-ink">CONFIRMED MEANS DOCUMENTED</div>
          <h2 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-strong sm:text-[40px]">Every finding shows its evidence and its doubts</h2>
          <p className="mt-3.5 text-[17px] leading-relaxed text-muted">A strong pattern is called <b className="font-medium text-text">likely</b>. Only a record that documents the cause itself (a failed inspection, the carrier’s damage scans) makes it <b className="font-medium text-text">confirmed</b>. Each finding lists other explanations to rule out and the data you’d need to be sure.</p>
        </div>
        <div className="card relative min-w-0 flex-[1_1_480px] overflow-hidden rounded-2xl p-6">
          <svg viewBox="0 0 440 120" width="100%" role="img" aria-label="A pattern, then a record that documents it, then proof the fix worked" className="block">
            <line x1="76" y1="40" x2="200" y2="40" stroke={ink('mint')} strokeWidth="2" className="anim-march" />
            <line x1="240" y1="40" x2="364" y2="40" stroke="rgb(var(--dim))" strokeWidth="2" strokeDasharray="3 5" />
            {[['Pattern', '16.2% vs 1.1%', true], ['Record', 'INSP-0419 failed', true], ['Fix proven', 'checking…', false]].map(([l, sub, ok], i) => {
              const x = 56 + i * 164
              return (
                <g key={l as string}>
                  {ok ? <><circle cx={x} cy={40} r={20} fill="rgb(var(--mint))" /><path d={`M${x - 8} 40l5 5 11-11`} stroke="#0b1520" strokeWidth="2.4" fill="none" /></>
                    : <><circle cx={x} cy={40} r={19} fill="none" stroke="rgb(var(--dim))" strokeWidth="1.5" strokeDasharray="3 3" className="anim-turn" /><text x={x} y={46} textAnchor="middle" fontSize="16" fill="rgb(var(--muted))">?</text></>}
                  <text x={x} y={84} textAnchor="middle" fontSize="13" fill="rgb(var(--text))">{l as string}</text>
                  <text x={x} y={102} textAnchor="middle" fontSize="11" fill="rgb(var(--muted))">{sub as string}</text>
                </g>
              )
            })}
          </svg>
          <div className="mt-4 rounded-xl border border-rose-ink/25 bg-rose-ink/[0.05] p-3 text-[13px]">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.06em] text-muted"><span className="inline-flex items-center gap-1.5"><Icon name="flask" size={13} className="text-rose-ink" />Inspection INSP-0419</span><span className="text-rose-ink">Documents it</span></div>
            <p className="mt-1.5 text-body">“Charging contacts misaligned on the left earbud in 7.8% of sampled units.”</p>
          </div>
        </div>
      </section>

      <section id="control" className="relative mx-auto grid max-w-[1200px] gap-4 px-6 pt-28 md:grid-cols-2">
        <div className="card flex flex-col gap-5 rounded-2xl p-6 sm:p-7">
          <div>
            <div className="font-mono text-[13px] text-mint-ink">YOU DECIDE</div>
            <h3 className="mt-2.5 text-[26px] font-semibold tracking-[-0.02em] text-strong">A specific fix for each cause</h3>
            <p className="mt-2.5 leading-relaxed text-muted">Batch inspection for defects, packaging tests for breakage, carrier reviews for transit damage, listing fixes for “not as described”. Each with an owner, a deadline and the money it should save.</p>
          </div>
          <div className="rounded-xl border border-sky-ink/25 bg-sky-ink/[0.05] p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-faint"><span className="rounded-full bg-rose px-2 py-px font-mono text-[10px] text-onpastel">P1</span>Packaging &amp; operations · due in 14 days</div>
            <div className="font-medium text-strong">Test double-wall packaging for the Mug Set</div>
            <ol className="mt-2 flex flex-col gap-1.5 text-[13px] text-body">
              {['Drop-test a double-wall box with dividers', 'Ship a trial batch', 'Compare damage returns against the old box'].map((x, i) => (
                <li key={x} className="flex gap-2"><span className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-panel font-mono text-[10px] text-muted">{i + 1}</span>{x}</li>
              ))}
            </ol>
            <div className="mt-3.5 flex gap-2"><span className="rounded-lg border border-line/10 bg-panel px-3 py-1.5 text-[13px]">Reject</span><span className="rounded-lg bg-mint px-3 py-1.5 text-[13px] font-medium text-onpastel">Approve</span></div>
          </div>
        </div>
        <div className="card flex flex-col gap-4 rounded-2xl p-6 sm:p-7">
          <div>
            <div className="font-mono text-[13px] text-butter-ink">IT CHECKS THE RESULT</div>
            <h3 className="mt-2.5 text-[26px] font-semibold tracking-[-0.02em] text-strong">Did the fix really work?</h3>
            <p className="mt-2.5 leading-relaxed text-muted">Same-length periods before and after, product mix held fixed, and other products as a control (the dashed line). If the problem comes back, you get an alert.</p>
          </div>
          <div className="rounded-xl border border-line/[0.08] bg-bg p-4">
            <div className="flex items-center justify-between text-[13px]"><span>Stoneware Mug Set · damaged packaging</span><span className="inline-flex items-center gap-1.5 text-xs text-mint-ink"><LiveDot />Improved</span></div>
            <Slope before={0.076} after={0.011} controlBefore={0.024} controlAfter={0.022} verdictTone="mint" format={(v) => `${(v * 100).toFixed(1)}%`}
              beforeLabel="45 days before" afterLabel="45 days after" label="Damage returns fell from 7.6% to 1.1% while other products stayed flat" />
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-[1200px] overflow-hidden px-6 pb-20 pt-32 text-center">
        <LensRings className="left-1/2 top-0 -translate-x-1/2" size={620} />
        <h2 className="relative text-[38px] font-semibold leading-[1.08] tracking-[-0.035em] text-strong sm:text-[46px]">Stop paying for the same return twice.</h2>
        <p className="relative mx-auto mt-4 max-w-[520px] text-[17px] leading-relaxed text-muted">Start with the sample store, then upload your own CSV or Excel exports.</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link to={start} className="btn-primary h-[46px] rounded-[10px] px-5 text-[15px]">{user ? 'Open app' : 'Get started free'}</Link>
          {!user && <Link to="/login" className="btn h-[46px] rounded-[10px] px-5 text-[15px]">Sign in</Link>}
        </div>
      </section>

      <footer className="relative mx-auto flex max-w-[1200px] flex-wrap gap-4 border-t border-line/[0.06] px-6 pb-10 pt-7 text-[13px] text-faint">
        <span>ReturnLens</span>
        <span className="ml-auto">For e-commerce and ops teams who’d rather fix the cause than process the return.</span>
      </footer>
    </div>
  )
}

/** A stream of complaints passes under a magnifier: only what's inside the lens is in focus. */
function LensDemo() {
  return (
    <div className="anim-rise relative h-[440px] min-w-0 flex-[1_1_480px] overflow-hidden rounded-2xl border border-line/[0.09] bg-panel shadow-pop" style={{ animationDelay: '.16s' }}
      role="img" aria-label="Customer complaints scroll under a magnifying lens, which picks out a repeated complaint about one earbud batch">
      <div className="anim-feed flex flex-col gap-2.5 p-[18px]" aria-hidden="true">
        {[...FEED, ...FEED].map(([id, text, tone], i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-[10px] border border-line/[0.07] bg-line/[0.02] px-3 py-2.5">
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: ink(tone) }} />
            <span className="flex-none font-mono text-[11px] text-faint">{id}</span>
            <span className="truncate text-[13px] text-body">{text}</span>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="lens-veil absolute inset-0" style={{ ['--x' as string]: '58%', ['--y' as string]: '46%', ['--r' as string]: '96px' } as CSSProperties} />
      <div aria-hidden="true" className="anim-breathe absolute h-[196px] w-[196px]" style={{ left: 'calc(58% - 98px)', top: 'calc(46% - 98px)' }}>
        <svg width="196" height="196" viewBox="0 0 196 196" className="absolute inset-0"><circle cx="98" cy="98" r="96" fill="none" strokeWidth="2" strokeDasharray="1 7" className="anim-turn" style={{ stroke: 'rgb(var(--sky-ink))' }} /></svg>
        <div className="absolute inset-[6px] rounded-full border-2 border-sky-ink" style={{ boxShadow: '0 20px 50px -20px rgb(var(--sky-ink) / .5)' }} />
        <div className="absolute -bottom-9 -right-9 h-3 w-14 origin-left rotate-45 rounded-md bg-text" />
      </div>
      <div className={cx('anim-tag absolute bottom-[22px] left-6 flex max-w-[300px] flex-col gap-1.5 rounded-xl border border-line/[0.12] bg-panel2 px-3.5 py-3 shadow-pop')}>
        <span className="eyebrow">Pattern spotted</span>
        <span className="text-sm font-medium text-strong">“left earbud won’t charge” · 42 returns</span>
        <span className="flex gap-1.5 text-xs text-onpastel"><span className="rounded-full bg-rose px-2 py-0.5">Batch B-EB-0712</span><span className="rounded-full bg-butter px-2 py-0.5">7× normal</span></span>
      </div>
    </div>
  )
}

function FindCard({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="card card-hover flex flex-col gap-4 rounded-2xl p-[22px]">
      <div className="flex h-[140px] items-center justify-center rounded-xl border border-line/[0.05] bg-line/[0.02]">{children}</div>
      <div>
        <div className="text-base font-medium">{title}</div>
        <div className="mt-1.5 text-sm leading-relaxed text-muted">{body}</div>
      </div>
    </div>
  )
}
