import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { dark as clerkDark, shadcn } from '@clerk/themes';
import {
  Activity, ArrowRight, Bell, Bookmark, BriefcaseBusiness, Building2,
  CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Eye, EyeOff, Flame,
  GraduationCap, LayoutDashboard, LogOut, MapPin, Moon, MoreHorizontal, Plus, RefreshCw, Search, Settings,
  SlidersHorizontal, Sparkles, Sun, Trash2, TrendingUp, X,
} from 'lucide-react';
import {
  getGetDashboardQueryKey, getListAlertsQueryKey,
  getListJobsQueryKey, getListWatchlistQueryKey, useAddStarterCompanies, useAddWatchlistCompany, useSetCompanyFollowed,
  useCreateAlert, useDeleteAlert, useGetDashboard, useGetInsights, useGetProfile,
  useListAlerts, useListJobLocations, useListJobs, useListWatchlist, useLoadDemoJobs, useRemoveWatchlistCompany,
  useSyncWatchlist, useUpdateAlert, useUpdateJob, useUpdateJobStatus, useUpdateProfile,
  getGetProfileQueryKey,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 800, refetchOnWindowFocus: false } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const THEME_KEY = 'job-watcher-theme';
function readTheme(): boolean {
  try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch { return false; }
}
// Light is the default. Apply before first paint so the page never flashes the wrong theme.
document.documentElement.classList.toggle('dark', readTheme());

// One shared theme switch for the login page and the app.
const themeListeners = new Set<() => void>();
const isDark = () => document.documentElement.classList.contains('dark');
function setDarkTheme(value: boolean) {
  document.documentElement.classList.toggle('dark', value);
  try { localStorage.setItem(THEME_KEY, value ? 'dark' : 'light'); } catch { /* private mode */ }
  themeListeners.forEach((listener) => listener());
}
function useDarkTheme(): [boolean, (value: boolean) => void] {
  const dark = useSyncExternalStore((cb) => { themeListeners.add(cb); return () => { themeListeners.delete(cb); }; }, isDark, () => false);
  return [dark, setDarkTheme];
}

// Changes show at once: every cached job list is patched first, then the server confirms.
function patchJobCaches(client: ReturnType<typeof useQueryClient>, id: number, next: string) {
  for (const [key, data] of client.getQueriesData<any[]>({ queryKey: getListJobsQueryKey() })) {
    if (!Array.isArray(data)) continue;
    const shown = (key[1] as { status?: string } | undefined)?.status;
    const keep = (st: string) => shown === 'pipeline' ? isApplied(st) : shown === 'tracked' ? !['new', 'hidden'].includes(st) : shown ? shown === st : st !== 'hidden';
    client.setQueryData(key, data.flatMap((job) => job.id !== id ? [job] : keep(next) ? [{ ...job, status: next }] : []));
  }
}

function useJobStatus(onDone?: (job: any) => void) {
  const client = useQueryClient();
  const mutation = useUpdateJobStatus();
  const refresh = () => { void client.invalidateQueries({ queryKey: getListJobsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const setStatus = (id: number, next: string) => {
    patchJobCaches(client, id, next);
    mutation.mutate({ id, data: { status: next as any } }, { onSuccess: (job) => { onDone?.(job); refresh(); }, onError: refresh });
  };
  return setStatus;
}

const LEVELS = [
  { value: 'internship', label: 'Internship', hint: 'Interns and trainees' },
  { value: 'fresher', label: 'Fresher', hint: '0–1 years' },
  { value: 'junior', label: 'Junior', hint: '1–3 years' },
  { value: 'mid', label: 'Mid-level', hint: '3–5 years' },
  { value: 'senior', label: 'Senior', hint: '5+ years' },
  { value: 'unspecified', label: 'Not specified', hint: 'No experience requirement stated' },
] as const;
const levelLabel = (value: string) => LEVELS.find(l => l.value === value)?.label ?? 'Not specified';
const isApplied = (status: string) => ['applied', 'oa', 'interview', 'offer'].includes(status);
const dateFmt = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const dateTimeFmt = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not checked yet';

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const navItems = [
  { href: '/feed', label: 'Job feed', icon: BriefcaseBusiness },
  { href: '/watchlist', label: 'Companies', icon: Building2 },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/tracker', label: 'Applications', icon: LayoutDashboard },
  { href: '/insights', label: 'Search insights', icon: TrendingUp },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function ClerkQueryCache() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUser = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const nextUser = user?.id ?? null;
    if (previousUser.current !== undefined && previousUser.current !== nextUser) client.clear();
    previousUser.current = nextUser;
  }), [addListener, client]);
  return null;
}

// Login box colours: the light set is the original Coastal Study look, the dark set is Rainy Library.
const clerkOptions = {
  logoPlacement: 'inside' as const,
  logoLinkUrl: basePath || '/',
  logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  unsafe_disableDevelopmentModeWarnings: true, // hides the orange "Development mode" label
};
const clerkLight = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: clerkOptions,
  variables: {
    colorPrimary: '#2F6465', colorForeground: '#22343A', colorMutedForeground: '#5B6B6E',
    colorDanger: '#8A4B3A', colorBackground: '#FBFAF8', colorInput: '#FBFAF8',
    colorInputForeground: '#22343A', colorNeutral: '#CBD5D4', fontFamily: '"DM Sans", sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#FBFAF8] rounded-2xl !w-full !max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#22343A] font-medium',
    headerSubtitle: 'text-[#5B6B6E]',
    socialButtonsBlockButtonText: 'text-[#22343A] font-semibold',
    formFieldLabel: 'text-[#22343A] font-semibold',
    footerActionLink: 'text-[#2F6465] font-semibold',
    footerActionText: 'text-[#5B6B6E]',
    dividerText: 'text-[#5B6B6E]',
    identityPreviewEditButton: 'text-[#2F6465]',
    formFieldSuccessText: 'text-[#42612b]',
    alertText: 'text-[#713b2e]',
    logoBox: 'mb-2', logoImage: 'w-10 h-10',
    socialButtonsBlockButton: 'border-[#CBD5D4] bg-[#F3F2EE] hover:bg-[#DCE9E8]',
    formButtonPrimary: 'bg-[#2F6465] hover:bg-[#244f50] text-white',
    formFieldInput: 'border-[#CBD5D4] bg-[#FBFAF8] text-[#22343A]',
    footerAction: 'text-[#5B6B6E]', dividerLine: 'bg-[#CBD5D4]',
    alert: 'bg-[#EFE1D3]', otpCodeFieldInput: 'border-[#CBD5D4]',
    formFieldRow: 'text-[#22343A]', main: 'text-[#22343A]',
  },
};
const clerkDarkAppearance = {
  theme: clerkDark,
  cssLayerName: 'clerk',
  options: clerkOptions,
  variables: {
    colorPrimary: '#8EC1BD', colorForeground: '#E8DFCB', colorMutedForeground: '#9C978B',
    colorDanger: '#E0907F', colorBackground: '#17222F', colorInput: '#111A26',
    colorInputForeground: '#E8DFCB', colorNeutral: '#E8DFCB', colorPrimaryForeground: '#0B111A',
    fontFamily: '"DM Sans", sans-serif', borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#17222F] rounded-2xl !w-full !max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#E8DFCB] font-medium',
    headerSubtitle: 'text-[#9C978B]',
    socialButtonsBlockButtonText: 'text-[#E8DFCB] font-semibold',
    formFieldLabel: 'text-[#E8DFCB] font-semibold',
    footerActionLink: 'text-[#8EC1BD] font-semibold',
    footerActionText: 'text-[#9C978B]',
    dividerText: 'text-[#9C978B]',
    identityPreviewEditButton: 'text-[#8EC1BD]',
    formFieldSuccessText: 'text-[#9AA66B]',
    alertText: 'text-[#E0907F]',
    logoBox: 'mb-2', logoImage: 'w-10 h-10',
    socialButtonsBlockButton: 'border-[#2A394C] bg-[#1F2D3E] hover:bg-[#2A394C]',
    formButtonPrimary: 'bg-[#8EC1BD] hover:bg-[#a3cfcb] text-[#0B111A]',
    formFieldInput: 'border-[#2A394C] bg-[#111A26] text-[#E8DFCB]',
    footerAction: 'text-[#9C978B]', dividerLine: 'bg-[#2A394C]',
    alert: 'bg-[#481911]', otpCodeFieldInput: 'border-[#2A394C]',
    formFieldRow: 'text-[#E8DFCB]', main: 'text-[#E8DFCB]',
  },
};

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [dark, setDark] = useDarkTheme();
  return <main className="auth-page">
    <button className="theme-toggle auth-theme" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} data-testid="button-auth-theme">{dark ? <Sun size={17} /> : <Moon size={17} />}<span>{dark ? 'Light' : 'Dark'}</span></button>
    <div className="auth-wrap">
      <div className="auth-note">
        <span className="brand-mark"><Activity size={17} /></span>
        <span className="brand-name">Job Watcher</span><span className="brand-separator">/</span><span className="muted">Jobs from company career pages, for your level</span>
      </div>
      <div className="auth-card">
        {mode === 'sign-in'
          ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
          : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}
      </div>
      <p className="auth-footnote">Sign in with Google to keep your own list of companies and applications.</p>
    </div>
  </main>;
}

function Home() {
  return <>
    <Show when="signed-in"><Redirect to="/feed" /></Show>
    <Show when="signed-out"><Redirect to="/sign-in" /></Show>
  </>;
}

function Guard({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  const [dark] = useDarkTheme();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    appearance={dark ? clerkDarkAppearance : clerkLight}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to see your jobs and applications.' } },
      signUp: { start: { title: 'Create your account', subtitle: 'Follow companies and track where you applied.' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryCache />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/sign-in/*?" component={() => <AuthPage mode="sign-in" />} />
        <Route path="/sign-up/*?" component={() => <AuthPage mode="sign-up" />} />
        {navItems.map(({ href }) => <Route key={href} path={href} component={ShellRoute} />)}
        <Route component={NotFound} />
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}

// Defined once, so changing the theme does not rebuild the page and wipe the filters.
function ShellRoute() { return <Guard><AppShell /></Guard>; }

function AppShell() {
  const [path] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useDarkTheme();
  const active = navItems.find((item) => item.href === path);
  return <div className="app-frame">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <Link href="/feed" className="sidebar-brand" data-testid="link-brand"><span className="brand-mark"><Activity size={17} /></span><span>Job Watcher</span></Link>
      <div className="sidebar-caption">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileNav(false)} className={`side-link ${path === href ? 'side-link-active' : ''}`} data-testid={`link-${href.slice(1)}`}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{href === '/alerts' && <span className="nav-dot" />}
        </Link>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="quiet-card"><Sparkles size={16} /><p>Real postings only.<br /><span>Pulled from company career pages.</span></p></div>
        <div className="profile-row">
          <div className="avatar">{(user?.firstName?.[0] || user?.emailAddresses[0]?.emailAddress?.[0] || 'Y').toUpperCase()}</div>
          <div className="profile-copy"><strong>{user?.firstName || 'Your workspace'}</strong><span>Personal account</span></div>
          <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="main-column">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav(!mobileNav)} data-testid="button-menu"><SlidersHorizontal size={19} /></button>
        <div className="crumb">{active?.label || 'Workspace'} <span>/</span> <span className="crumb-current">{active?.href === '/feed' ? 'Jobs' : 'Overview'}</span></div>
        <div className="topbar-actions"><span className="today-label">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
          <button className="theme-toggle" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} data-testid="button-theme">{dark ? <Sun size={17} /> : <Moon size={17} />}<span>{dark ? 'Light' : 'Dark'}</span></button>
        </div>
      </header>
      <div className="page-area page-enter">
        <Switch>
          <Route path="/feed" component={FeedPage} />
          <Route path="/watchlist" component={WatchlistPage} />
          <Route path="/alerts" component={AlertsPage} />
          <Route path="/tracker" component={TrackerPage} />
          <Route path="/insights" component={InsightsPage} />
          <Route path="/settings">{() => <SettingsPage dark={dark} setDark={setDark} />}</Route>
        </Switch>
      </div>
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1 className="display-title">{title}</h1><p className="heading-copy">{text}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

function LoadingRows() {
  return <div className="skeleton-list" aria-label="Loading"><div className="skeleton wide" /><div className="skeleton" /><div className="skeleton" /></div>;
}

function ErrorNotice({ retry }: { retry: () => void }) {
  return <div className="state-card"><div className="state-icon clay"><CircleHelp size={19} /></div><h3>That didn’t load</h3><p>Give it another try. Your saved work is still here.</p><button className="button button-secondary" onClick={retry} data-testid="button-retry">Try again</button></div>;
}

function EmptyState({ title, text, icon: Icon = BriefcaseBusiness }: { title: string; text: string; icon?: typeof BriefcaseBusiness }) {
  return <div className="state-card"><div className="state-icon"><Icon size={19} /></div><h3>{title}</h3><p>{text}</p></div>;
}

function Badge({ children, tone = 'teal' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function LevelChip({ level }: { level: string }) {
  return <Badge tone={level === 'unspecified' ? 'salt' : level === 'fresher' || level === 'internship' ? 'moss' : 'teal'}>{levelLabel(level)}</Badge>;
}

function AppliedButton({ job, onStatus, small = true, testId }: { job: any; onStatus: (id: number, status: string) => void; small?: boolean; testId: string }) {
  const done = isApplied(job.status);
  const locked = done && job.status !== 'applied';
  return <button className={`button ${small ? 'button-small' : ''} ${done ? 'button-primary' : 'button-secondary'}`} disabled={locked}
    title={locked ? 'Change the stage in the Applications page' : done ? 'Click to undo' : 'Mark as applied'}
    onClick={() => onStatus(job.id, done ? 'new' : 'applied')} data-testid={testId}>
    {done ? <><Check size={14} /> Applied</> : 'Mark applied'}</button>;
}

function JobCard({ job, onStatus, onOpen }: { job: any; onStatus: (id: number, status: string) => void; onOpen: (job: any) => void }) {
  const isNew = job.status === 'new' && Date.now() - new Date(job.postedAt).getTime() < 24 * 3600000;
  return <article className="job-card surface" data-testid={`card-job-${job.id}`}>
    <div className="company-monogram">{job.companyInitials || job.company.slice(0, 2).toUpperCase()}</div>
    <div className="job-main">
      <div className="job-title-line"><a className="job-title" href={job.applicationUrl} target="_blank" rel="noreferrer" title="Open the application page" data-testid={`link-apply-${job.id}`}>{job.title}</a>
        {isNew && <Badge tone="moss">NEW</Badge>}{job.isSample && <Badge tone="salt">Demo role</Badge>}</div>
      <div className="job-company">{job.company}<span>·</span>{job.location}</div>
      <div className="job-chips"><LevelChip level={job.experienceLevel} /><span className="exp-text">{job.experience}</span></div>
      <p className="job-summary">{job.summary}</p>
      <div className="job-meta"><span><CalendarDays size={13} />Posted {dateFmt(job.postedAt)}</span><button className="link-button" onClick={() => onOpen(job)} data-testid={`button-job-details-${job.id}`}>Details</button>{job.batchYear && <span><GraduationCap size={13} />Batch {job.batchYear}</span>}</div>
      <div className="skill-row">{(job.skills || []).slice(0, 4).map((skill: string) => <span key={skill} className="skill">{skill}</span>)}</div>
    </div>
    <div className="job-actions">
      <AppliedButton job={job} onStatus={onStatus} testId={`button-applied-${job.id}`} />
      <div className="job-icons">
        <button className={`icon-button ${job.status === 'saved' ? 'saved-active' : ''}`} title={job.status === 'saved' ? 'Remove from saved' : 'Save role'} aria-label={job.status === 'saved' ? 'Unsave role' : 'Save role'} onClick={() => onStatus(job.id, job.status === 'saved' ? 'new' : 'saved')} data-testid={`button-save-${job.id}`}><Bookmark size={17} fill={job.status === 'saved' ? 'currentColor' : 'none'} /></button>
        <button className={`icon-button ${job.status === 'hidden' ? 'saved-active' : ''}`} title={job.status === 'hidden' ? 'Show this role again' : 'Hide role'} aria-label={job.status === 'hidden' ? 'Unhide role' : 'Hide role'} onClick={() => onStatus(job.id, job.status === 'hidden' ? 'new' : 'hidden')} data-testid={`button-hide-${job.id}`}>{job.status === 'hidden' ? <Eye size={16} /> : <EyeOff size={16} />}</button>
      </div>
    </div>
  </article>;
}

function cityOptions(jobs: any[]): string[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    for (const part of String(job.location).split(/[,;·|/()]|\s-\s/)) {
      const t = part.trim();
      if (t.length > 1 && t.length < 30 && t.toLowerCase() !== 'not specified') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t]) => t);
}

function FeedPage() {
  const [q, setQ] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [company, setCompany] = useState('');
  const [level, setLevel] = useState('any');
  const [levelTouched, setLevelTouched] = useState(false);
  const [includeUnspecified, setIncludeUnspecified] = useState(true);
  const [stage, setStage] = useState<'all' | 'following' | 'saved' | 'pipeline' | 'hidden'>('all');
  const [newOnly, setNewOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const [activeJob, setActiveJob] = useState<any>(null);
  const [focusedJobIndex, setFocusedJobIndex] = useState(-1);
  const client = useQueryClient();
  const profile = useGetProfile();
  useEffect(() => { if (!levelTouched && profile.data) setLevel(profile.data.experienceLevel); }, [profile.data, levelTouched]);
  const params = useMemo(() => ({
    q: q || undefined, location: locationFilter || undefined, company: company || undefined, newOnly: newOnly || undefined,
    status: stage === 'all' || stage === 'following' ? undefined : stage,
    followedOnly: stage === 'following' ? true : undefined,
    experienceLevel: level === 'any' ? undefined : level as any,
    includeUnspecified: level !== 'any' && level !== 'unspecified' && includeUnspecified ? true : undefined,
    limit,
  }), [q, locationFilter, company, newOnly, stage, level, includeUnspecified, limit]);
  useEffect(() => { setLimit(60); }, [q, locationFilter, company, newOnly, stage, level, includeUnspecified]);
  const jobs = useListJobs(params, { query: { placeholderData: (previous: any) => previous } as any });
  const locations = useListJobLocations();
  const watchlist = useListWatchlist();
  const locationChoices = useMemo(() => cityOptions((locations.data || []).map(location => ({ location }))), [locations.data]);
  const visibleJobs = jobs.data || [];
  const demo = useLoadDemoJobs();
  const sync = useSyncWatchlist();
  const refreshAll = () => { void client.invalidateQueries({ queryKey: getListJobsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); void client.invalidateQueries({ queryKey: getListWatchlistQueryKey() }); };
  const handleStatus = useJobStatus((updated) => setActiveJob((current: any) => current?.id === updated.id ? (updated.status === 'hidden' ? null : updated) : current));
  const lastChecked = (watchlist.data || []).map(c => c.lastCheckedAt).filter(Boolean).sort().pop() as string | undefined;
  const hasCompanies = (watchlist.data || []).length > 0;
  const fetching = (watchlist.data || []).filter(c => !c.lastCheckedAt).length;
  useEffect(() => { if (!fetching) return; const timer = setInterval(refreshAll, 3000); return () => clearInterval(timer); }, [fetching]);
  const filtersOn = !!(q || locationFilter || company || newOnly || stage !== 'all' || level !== 'any');
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape' && activeJob) { setActiveJob(null); return; }
      if (event.key === 'j' || event.key === 'k') {
        if (!visibleJobs.length) return;
        event.preventDefault();
        const next = event.key === 'j' ? (focusedJobIndex + 1) % visibleJobs.length : (focusedJobIndex <= 0 ? visibleJobs.length - 1 : focusedJobIndex - 1);
        setFocusedJobIndex(next); setActiveJob(visibleJobs[next]); return;
      }
      const targetJob = activeJob ?? visibleJobs[focusedJobIndex];
      if (targetJob && event.key === 's') handleStatus(targetJob.id, targetJob.status === 'saved' ? 'new' : 'saved');
      if (targetJob && event.key === 'a') handleStatus(targetJob.id, isApplied(targetJob.status) ? (targetJob.status === 'applied' ? 'new' : targetJob.status) : 'applied');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeJob, focusedJobIndex, visibleJobs]);
  const clearAll = () => { setQ(''); setLocationFilter(''); setCompany(''); setLevel('any'); setLevelTouched(true); setStage('all'); setNewOnly(false); };
  return <div>
    <PageHeading eyebrow="JOBS FROM YOUR COMPANIES" title="Find roles that fit your level." text="Pick your experience level and see openings from the companies you follow." action={<div className="heading-buttons">
      <button className="button button-secondary" disabled={sync.isPending || !hasCompanies} onClick={() => sync.mutate(undefined, { onSuccess: refreshAll })} data-testid="button-check-now"><RefreshCw size={15} className={sync.isPending ? 'spin' : ''} />{sync.isPending ? 'Checking…' : 'Check now'}</button>
      <button className={`button ${newOnly ? 'button-primary' : 'button-secondary'}`} onClick={() => setNewOnly(!newOnly)} data-testid="button-new-24h"><Flame size={16} />Posted in last 24h<span className="toggle-indicator">{newOnly ? 'On' : 'Off'}</span></button></div>} />
    <div className="feed-intro"><div><span className="live-mark" /> {hasCompanies ? <>Last checked <strong>{dateTimeFmt(lastChecked)}</strong></> : 'No companies followed yet'}<span className="intro-divider">·</span><span className="muted">Checked automatically every 30 minutes</span></div><div className="mono-count">{jobs.data ? `${visibleJobs.length}${visibleJobs.length >= limit ? '+' : ''} roles${fetching ? ` · fetching ${fetching} companies…` : ''}` : '—'}</div></div>
    {sync.data && <div className="notice-strip"><RefreshCw size={16} /><p>Checked {sync.data.checked} {sync.data.checked === 1 ? 'company' : 'companies'}: <strong>{sync.data.newJobs} new {sync.data.newJobs === 1 ? 'role' : 'roles'}</strong>{sync.data.errors ? `, ${sync.data.errors} could not be reached` : ''}.</p></div>}
    <section className="level-bar panel" aria-label="Experience level">
      <div className="level-bar-title"><GraduationCap size={16} /><strong>Experience level</strong></div>
      <div className="level-pills" role="radiogroup" aria-label="Experience level">
        {[{ value: 'any', label: 'Any level', hint: 'Everything' }, ...LEVELS].map(l => <button key={l.value} role="radio" aria-checked={level === l.value} title={l.hint} className={`level-pill ${level === l.value ? 'level-pill-active' : ''}`} onClick={() => { setLevel(l.value); setLevelTouched(true); }} data-testid={`level-${l.value}`}>{l.label}<small>{l.value === 'any' ? '' : l.hint.includes('years') ? l.hint : ''}</small></button>)}
      </div>
      {level !== 'any' && level !== 'unspecified' && <label className="check-label level-extra"><input type="checkbox" checked={includeUnspecified} onChange={e => setIncludeUnspecified(e.target.checked)} data-testid="check-include-unspecified" />Also show roles that don’t state experience</label>}
    </section>
    <section className="filter-panel panel" aria-label="Filter jobs">
      <label className="search-input"><Search size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Role, skill, or keyword" aria-label="Search jobs" data-testid="input-job-search" />{q && <button onClick={() => setQ('')} aria-label="Clear search" className="clear-search"><X size={14} /></button>}</label>
      <label className="select-wrap"><MapPin size={15} /><input list="location-options" value={locationFilter} onChange={e => setLocationFilter(e.target.value)} placeholder="Location" aria-label="Filter by location" data-testid="input-location" /><datalist id="location-options">{['Remote', ...locationChoices.filter(c => c.toLowerCase() !== 'remote')].map(c => <option key={c} value={c} />)}</datalist></label>
      <label className="select-wrap"><Building2 size={15} /><input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company" aria-label="Filter by company" data-testid="input-company-filter" /></label>
      <div className="stage-tabs" role="radiogroup" aria-label="Show">{([['all', 'All companies'], ['following', 'Following'], ['saved', 'Saved'], ['pipeline', 'Applied'], ['hidden', 'Hidden']] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={stage === v} className={`stage-tab ${stage === v ? 'stage-tab-active' : ''}`} onClick={() => setStage(v)} data-testid={`stage-${v}`}>{l}</button>)}</div>
      <button className="filter-reset" onClick={clearAll} data-testid="button-clear-filters">Clear</button>
    </section>
    {jobs.isLoading ? <LoadingRows /> : jobs.isError ? <ErrorNotice retry={() => void jobs.refetch()} /> : visibleJobs.length === 0
      ? (!hasCompanies && !filtersOn && !visibleJobs.length
        ? <div className="state-card"><div className="state-icon"><Building2 size={19} /></div><h3>Start by following a company</h3><p>Add a company’s Greenhouse, Lever or Ashby careers link and its open roles appear here, sorted by experience level.</p><div className="state-actions"><Link href="/watchlist" className="button button-primary" data-testid="link-add-first-company"><Plus size={16} />Follow a company</Link><button className="button button-secondary" disabled={demo.isPending} onClick={() => demo.mutate(undefined, { onSuccess: refreshAll })} data-testid="button-load-demo">Load demo roles to explore</button></div></div>
        : <EmptyState title={stage === 'following' ? 'No followed companies yet' : 'No roles match'} text={stage === 'following' ? 'Open Companies and click Follow on the ones you care about. Their roles will show here.' : filtersOn ? 'Try another experience level or clear a filter.' : 'Nothing new yet. Use “Check now” to look again.'} />)
      : <div className="job-list">{visibleJobs.map((job: any) => <JobCard key={job.id} job={job} onStatus={handleStatus} onOpen={setActiveJob} />)}{visibleJobs.length >= limit && <button className="button button-secondary load-more" onClick={() => setLimit(limit + 60)} disabled={jobs.isFetching} data-testid="button-load-more">{jobs.isFetching ? 'Loading…' : 'Show more roles'}</button>}</div>}
    <div className="feed-disclosure"><CircleHelp size={15} /><span>Experience level is worked out from the job title and description, so check the posting itself. Roles that state no requirement are labelled <strong>Not specified</strong>. <strong>Shortcuts:</strong> j / k browse, s save, a applied.</span></div>
    {activeJob && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setActiveJob(null); }}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button className="modal-close icon-button" onClick={() => setActiveJob(null)} aria-label="Close job details"><X size={18} /></button><div className="company-monogram large">{activeJob.companyInitials || activeJob.company.slice(0, 2)}</div><div className="eyebrow">{activeJob.company} · {activeJob.location}</div><h2 id="detail-title" className="display-title">{activeJob.title}</h2><div className="detail-meta"><LevelChip level={activeJob.experienceLevel} /> {activeJob.experience}{activeJob.batchYear ? <> <span>·</span> Batch {activeJob.batchYear}</> : null}{activeJob.isSample && <Badge tone="salt">Demo role</Badge>}</div><div className="detail-summary">{(activeJob.description && activeJob.description.trim() ? activeJob.description : 'The full description is on the company\u2019s own page. Use \u201cOpen application page\u201d below to read it and apply.').split('\n').map((line: string, index: number) => <span key={index} className={(activeJob.skills || []).some((skill: string) => line.toLowerCase().includes(skill.toLowerCase())) ? 'match-line' : ''}>{line || ' '}</span>)}</div>{!!(activeJob.skills || []).length && <><h3>Skills mentioned</h3><div className="skill-row">{(activeJob.skills || []).map((skill: string) => <span key={skill} className="skill">{skill}</span>)}</div></>}<div className="detail-history"><span>Posted <strong>{dateFmt(activeJob.postedAt)}</strong></span><span>First seen here <strong>{dateTimeFmt(activeJob.firstSeenAt)}</strong></span></div><div className="detail-foot"><a className="button button-primary" href={activeJob.applicationUrl} target="_blank" rel="noreferrer">Open application page <ArrowRight size={15} /></a><AppliedButton job={activeJob} onStatus={handleStatus} small={false} testId={`button-detail-applied-${activeJob.id}`} /><button className="button button-secondary" onClick={() => handleStatus(activeJob.id, 'hidden')}>Hide role</button></div></section></div>}
  </div>;
}

// "Add popular companies": follows a ready-made list, then keeps refreshing while jobs arrive in the background.
function useStarterPack(refresh: () => void) {
  const mutation = useAddStarterCompanies();
  const [busy, setBusy] = useState(false);
  const start = () => mutation.mutate(undefined, {
    onSuccess: () => {
      setBusy(true); refresh();
      const timer = setInterval(refresh, 3000);
      setTimeout(() => { clearInterval(timer); setBusy(false); refresh(); }, 90_000);
    },
  });
  return { start, busy: busy || mutation.isPending };
}

const SUGGESTIONS = [
  { name: 'Stripe', url: 'https://boards.greenhouse.io/stripe' },
  { name: 'Cloudflare', url: 'https://boards.greenhouse.io/cloudflare' },
  { name: 'Databricks', url: 'https://boards.greenhouse.io/databricks' },
  { name: 'Postman', url: 'https://boards.greenhouse.io/postman' },
  { name: 'Notion', url: 'https://jobs.ashbyhq.com/notion' },
  { name: 'Ramp', url: 'https://jobs.ashbyhq.com/ramp' },
  { name: 'Spotify', url: 'https://jobs.lever.co/spotify' },
];
const sourceLabel: Record<string, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', web: 'Careers page' };

function WatchlistPage() {
  const client = useQueryClient();
  const companies = useListWatchlist();
  const add = useAddWatchlistCompany();
  const remove = useRemoveWatchlistCompany();
  const setFollowed = useSetCompanyFollowed();
  const sync = useSyncWatchlist();
  const [showForm, setShowForm] = useState(false);
  const starterRefresh = () => { void client.invalidateQueries({ queryKey: getListWatchlistQueryKey() }); void client.invalidateQueries({ queryKey: getListJobsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const starter = useStarterPack(starterRefresh);
  const [name, setName] = useState('');
  const [careersUrl, setCareersUrl] = useState('');
  const [formError, setFormError] = useState('');
  const refresh = () => { void client.invalidateQueries({ queryKey: getListWatchlistQueryKey() }); void client.invalidateQueries({ queryKey: getListJobsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!name.trim() && !careersUrl.trim()) { setFormError('Enter a company name or paste its careers link.'); return; }
    add.mutate({ data: { name: name.trim() || undefined, careersUrl: careersUrl.trim() || null } }, {
      onSuccess: () => { setName(''); setCareersUrl(''); setShowForm(false); refresh(); },
      onError: (err: any) => setFormError(err?.data?.error || err?.message || 'Couldn’t add that company. Please try again.'),
    });
  };
  return <div><PageHeading eyebrow="COMPANIES YOU FOLLOW" title="Companies." text="Every company here has its jobs in your feed. Follow the ones you care about to get a Following tab." action={<div className="heading-buttons"><button className="button button-secondary" disabled={sync.isPending || !companies.data?.length} onClick={() => sync.mutate(undefined, { onSuccess: refresh })} data-testid="button-sync-companies"><RefreshCw size={15} className={sync.isPending ? 'spin' : ''} />{sync.isPending ? 'Checking…' : 'Check now'}</button><button className="button button-secondary" disabled={starter.busy} onClick={starter.start} data-testid="button-add-popular">{starter.busy ? 'Adding companies…' : 'Add popular companies'}</button><button className="button button-primary" onClick={() => setShowForm(!showForm)} data-testid="button-add-company"><Plus size={16} />Follow a company</button></div>} />
    {showForm && <form className="inline-form surface" onSubmit={submit}><div className="form-heading"><strong>Follow a company</strong><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close form"><X size={16} /></button></div>
      <p className="form-help">Paste the company’s careers link. Greenhouse, Lever and Ashby boards work best; for other sites we read the page’s job data when it has any. Or type just the name and we’ll look for a board.</p>
      <div className="form-fields"><label>Careers link<input value={careersUrl} onChange={e => setCareersUrl(e.target.value)} placeholder="https://boards.greenhouse.io/company" data-testid="input-careers-url" /></label><label>Company name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Stripe" data-testid="input-company-name" /></label></div>
      <div className="suggest-row"><span>Try one:</span>{SUGGESTIONS.map(s => <button type="button" key={s.name} className="suggest-chip" onClick={() => { setName(s.name); setCareersUrl(s.url); }}>{s.name}</button>)}</div>
      <button className="button button-primary" disabled={add.isPending} data-testid="button-submit-company">{add.isPending ? 'Finding jobs…' : 'Follow company'}</button>{formError && <p className="form-error" role="alert" data-testid="text-company-error">{formError}</p>}</form>}
    {companies.isLoading ? <LoadingRows /> : companies.isError ? <ErrorNotice retry={() => void companies.refetch()} /> : !companies.data?.length ? <EmptyState title="Your list starts here" text="Follow a company, or click “Add popular companies” to start with about 40 well-known ones. Their jobs are fetched automatically." icon={Building2} /> :
      <div className="company-list">{companies.data.map(company => <article className="company-row surface" key={company.id} data-testid={`card-company-${company.id}`}><div className="company-monogram">{company.initials || company.name.slice(0,2).toUpperCase()}</div><div className="company-row-copy"><strong>{company.name} {company.source ? <Badge tone="teal">{sourceLabel[company.source]}</Badge> : <Badge tone="salt">Manual only</Badge>}</strong><span>{company.source ? <>{company.rolesOpen} open roles <span>·</span> Last checked {dateTimeFmt(company.lastCheckedAt)}</> : 'No job board found, so roles can’t be fetched automatically.'}</span>{company.lastStatus === 'error' && <span className="company-error">Last check failed: {company.lastError}</span>}</div>{company.website && <a href={company.website} target="_blank" rel="noreferrer" className="text-link">Visit site <ArrowRight size={14} /></a>}<button className={`button button-small ${company.followed ? 'button-primary' : 'button-secondary'}`} disabled={setFollowed.isPending} onClick={() => setFollowed.mutate({ id: company.id, data: { followed: !company.followed } }, { onSuccess: refresh })} title={company.followed ? 'Click to unfollow' : 'Follow to see it in the Following tab'} data-testid={`button-follow-${company.id}`}>{company.followed ? <><Check size={14} /> Following</> : 'Follow'}</button><button className="icon-button danger-icon" disabled={remove.isPending} aria-label={`Remove ${company.name}`} title="Remove this company and its roles" onClick={() => { if (window.confirm(`Remove ${company.name}? Roles you haven’t saved or applied to will be removed.`)) remove.mutate({ id: company.id }, { onSuccess: refresh }); }} data-testid={`button-unfollow-${company.id}`}><Trash2 size={15} /></button></article>)}</div>}
  </div>;
}

function AlertsPage() {
  const client = useQueryClient();
  const alerts = useListAlerts();
  const create = useCreateAlert();
  const update = useUpdateAlert();
  const remove = useDeleteAlert();
  const [form, setForm] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [role, setRole] = useState('');
  const [locations, setLocations] = useState('');
  const [channels, setChannels] = useState<string[]>(['email']);
  const [alertLevel, setAlertLevel] = useState('any');
  const reset = () => { setRole(''); setLocations(''); setChannels(['email']); setAlertLevel('any'); setEditing(null); setForm(false); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const data = { role: role.trim(), locations: locations.split(',').map(s => s.trim()).filter(Boolean), channels: channels as ('email' | 'telegram')[], experienceLevel: alertLevel as any };
    const key = getListAlertsQueryKey();
    const done = (saved: any, isNew: boolean) => {
      // Show the saved rule right away; the background refresh below only corrects the match count.
      client.setQueryData(key, (old: any) => isNew ? [...(old ?? []), saved] : (old ?? []).map((r: any) => r.id === saved.id ? saved : r));
      reset();
      void client.invalidateQueries({ queryKey: key });
    };
    if (editing !== null) update.mutate({ id: editing, data }, { onSuccess: (saved: any) => done(saved, false) });
    else create.mutate({ data }, { onSuccess: (saved: any) => done(saved, true) });
  };
  const editRule = (rule: any) => { setEditing(rule.id); setRole(rule.role); setLocations(rule.locations.join(', ')); setChannels(rule.channels); setAlertLevel(rule.experienceLevel || 'any'); setForm(true); };
  const toggleChannel = (key: string) => setChannels(current => current.includes(key) ? current.filter(c => c !== key) : [...current, key]);
  return <div><PageHeading eyebrow="SAVED SEARCHES" title="Saved searches." text="Save a role, location and level. You get an email when a new matching role appears, and see how many matched last week." action={<button className="button button-primary" onClick={() => { reset(); setForm(true); }} data-testid="button-new-alert"><Plus size={16} />New alert</button>} />
    <div className="notice-strip"><Bell size={16} /><p><strong>Email alerts.</strong> New matching roles are emailed to your Google account address, usually within 5–30 minutes of being found.</p></div>
    {form && <form className="inline-form surface" onSubmit={submit}><div className="form-heading"><strong>{editing !== null ? 'Edit saved search' : 'Create a saved search'}</strong><button type="button" className="icon-button" onClick={reset} aria-label="Close form"><X size={16} /></button></div><div className="form-fields"><label>Role or keywords<input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Product designer" required data-testid="input-alert-role" /></label><label>Locations, separated by commas<input value={locations} onChange={e => setLocations(e.target.value)} placeholder="Bengaluru, Remote" data-testid="input-alert-locations" /></label><label>Experience level<select value={alertLevel} onChange={e => setAlertLevel(e.target.value)} data-testid="select-alert-level"><option value="any">Any level</option>{LEVELS.filter(l => l.value !== 'unspecified').map(l => <option key={l.value} value={l.value}>{l.label} ({l.hint})</option>)}</select></label></div><div className="channel-select"><span>Preferred channel</span>{['email'].map(channel => <label key={channel} className="check-label"><input type="checkbox" checked={channels.includes(channel)} onChange={() => toggleChannel(channel)} />{channel === 'email' ? 'Email' : 'Telegram'}</label>)}</div><button className="button button-primary" disabled={create.isPending || update.isPending} data-testid="button-save-alert">{create.isPending || update.isPending ? 'Saving…' : editing !== null ? 'Save changes' : 'Save alert'}</button></form>}
    {alerts.isLoading ? <LoadingRows /> : alerts.isError ? <ErrorNotice retry={() => void alerts.refetch()} /> : !alerts.data?.length ? <EmptyState title="Nothing to watch for yet" text="Create an alert rule to save the roles and locations you care about." icon={Bell} /> :
      <div className="alert-list">{alerts.data.map(rule => <article className="alert-card surface" key={rule.id} data-testid={`card-alert-${rule.id}`}><div className="alert-card-top"><div className="alert-symbol"><Search size={17} /></div><div className="alert-name"><h3>{rule.role}</h3><span>{rule.locations.length ? rule.locations.join(' · ') : 'Any location'} · {rule.experienceLevel === 'any' ? 'Any level' : levelLabel(rule.experienceLevel)}</span></div><button className={`switch ${rule.enabled ? 'switch-on' : ''}`} role="switch" aria-checked={rule.enabled} aria-label={`Turn ${rule.role} alert ${rule.enabled ? 'off' : 'on'}`} onClick={() => { client.setQueryData(getListAlertsQueryKey(), (old: any) => (old ?? []).map((r: any) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r)); update.mutate({ id: rule.id, data: { enabled: !rule.enabled } }, { onSettled: () => void client.invalidateQueries({ queryKey: getListAlertsQueryKey() }) }); }} data-testid={`button-toggle-alert-${rule.id}`}><span /></button></div><div className="alert-bottom"><div className="alert-stat"><strong className="font-mono">{rule.matchingJobsLastWeek}</strong><span>matches last week</span></div><div className="alert-channels">{rule.channels.map(c => <Badge key={c} tone="salt">{c}</Badge>)}<Badge tone="clay">{rule.deliveryConnected ? 'Delivery connected' : 'Not delivering'}</Badge></div><div className="alert-actions"><button className="icon-button" aria-label={`Edit ${rule.role}`} title="Edit" onClick={() => editRule(rule)} data-testid={`button-edit-alert-${rule.id}`}><MoreHorizontal size={18} /></button><button className="icon-button danger-icon" aria-label={`Delete ${rule.role}`} title="Delete" onClick={() => { if (window.confirm(`Delete the ${rule.role} alert?`)) { client.setQueryData(getListAlertsQueryKey(), (old: any) => (old ?? []).filter((r: any) => r.id !== rule.id)); remove.mutate({ id: rule.id }, { onSettled: () => void client.invalidateQueries({ queryKey: getListAlertsQueryKey() }) }); } }} data-testid={`button-delete-alert-${rule.id}`}><Trash2 size={16} /></button></div></div></article>)}</div>}
  </div>;
}

const pipeline = [
  { key: 'saved', name: 'Saved', tone: 'teal' }, { key: 'applied', name: 'Applied', tone: 'salt' },
  { key: 'oa', name: 'Assessment', tone: 'moss' }, { key: 'interview', name: 'Interview', tone: 'clay' },
  { key: 'offer', name: 'Offer', tone: 'moss' }, { key: 'rejected', name: 'Rejected', tone: 'clay' },
];
function TrackerPage() {
  const client = useQueryClient();
  const jobs = useListJobs({ includeClosed: true, status: 'tracked', limit: 500 });
  const update = useUpdateJob();
  const setStatus = useJobStatus();
  const [followUps, setFollowUps] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const refresh = () => { void client.invalidateQueries({ queryKey: getListJobsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  return <div><PageHeading eyebrow="WHERE YOU APPLIED" title="Your applications." text="Move roles through each stage and set a follow-up date." />
    {jobs.isLoading ? <LoadingRows /> : jobs.isError ? <ErrorNotice retry={() => void jobs.refetch()} /> : <div className="pipeline-grid">{pipeline.map(stage => {
      const items = (jobs.data || []).filter((job: any) => job.status === stage.key);
      return <section className="pipeline-column" key={stage.key} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(id) && id > 0) setStatus(id, stage.key); }}><div className="pipeline-heading"><span>{stage.name}</span><span className="pipeline-count font-mono">{items.length}</span></div>{items.length ? items.map((job: any) => <article className="pipeline-card surface" key={job.id} draggable onDragStart={event => event.dataTransfer.setData('text/plain', String(job.id))} data-testid={`tracker-card-${job.id}`}><div className="pipeline-company">{job.company}{job.closedAt && <Badge tone="clay">Closed</Badge>}</div><h3>{job.title}</h3><div className="pipeline-location"><MapPin size={13} />{job.location}</div><label className="follow-date">Follow up on<input type="date" value={followUps[job.id] ?? job.followUpDate?.slice(0,10) ?? ''} onChange={e => setFollowUps(current => ({ ...current, [job.id]: e.target.value }))} onBlur={() => { const date = followUps[job.id]; if (date !== undefined && date !== (job.followUpDate?.slice(0,10) || '')) update.mutate({ id: job.id, data: { followUpDate: date || null } }, { onSuccess: refresh }); }} aria-label={`Follow-up date for ${job.company}`} data-testid={`input-follow-up-${job.id}`} /></label><label className="notes-field">Private note<textarea value={notes[job.id] ?? job.notes ?? ''} onChange={e => setNotes(current => ({ ...current, [job.id]: e.target.value }))} onBlur={() => { const note = notes[job.id]; if (note !== undefined && note !== (job.notes || '')) update.mutate({ id: job.id, data: { notes: note || null } }, { onSuccess: refresh }); }} placeholder="A detail to remember…" aria-label={`Private note for ${job.company}`} data-testid={`input-notes-${job.id}`} /></label><div className="pipeline-card-actions"><select aria-label={`Move ${job.title} to stage`} value={job.status} onChange={e => setStatus(job.id, e.target.value)} data-testid={`select-stage-${job.id}`}><option value="saved">Saved</option><option value="applied">Applied</option><option value="oa">Assessment</option><option value="interview">Interview</option><option value="offer">Offer</option><option value="rejected">Rejected</option></select></div></article>) : <div className="pipeline-empty">No roles here yet</div>}</section>;
    })}</div>}
    {!jobs.isLoading && !jobs.isError && <div className="tracker-note"><CalendarDays size={15} />Set a follow-up date to make a small next step visible.</div>}
  </div>;
}

function InsightsPage() {
  const insights = useGetInsights();
  const dashboard = useGetDashboard();
  if (insights.isLoading || dashboard.isLoading) return <div><PageHeading eyebrow="A WIDER VIEW" title="Search insights." text="Patterns from your roles and applications." /><LoadingRows /></div>;
  if (insights.isError || dashboard.isError) return <ErrorNotice retry={() => { void insights.refetch(); void dashboard.refetch(); }} />;
  const data = insights.data;
  const summary = dashboard.data;
  const maxDay = Math.max(1, ...(data?.postingsByDay || []).map(m => m.value));
  const maxCompany = Math.max(1, ...(data?.topCompanies || []).map(m => m.value));
  const maxHour = Math.max(1, ...(data?.postingHours || []).map(m => m.value));
  const maxLevel = Math.max(1, ...(data?.byLevel || []).map(m => m.value));
  return <div><PageHeading eyebrow="A WIDER VIEW" title="Search insights." text="A few useful patterns from your roles and applications." />
    <div className="metric-grid"><div className="metric-card surface"><span>Total roles in view</span><strong className="font-mono">{data?.totalJobs ?? 0}</strong><small>Open roles from your companies</small></div><div className="metric-card surface"><span>Application rate</span><strong className="font-mono">{data?.applicationRate ?? 0}%</strong><small>Roles moved to applied</small></div><div className="metric-card surface"><span>Active applications</span><strong className="font-mono">{summary?.activeApplications ?? 0}</strong><small>Currently in progress</small></div><div className="metric-card surface"><span>Interviews</span><strong className="font-mono">{summary?.interviews ?? 0}</strong><small>Currently at interview stage</small></div></div>
    <div className="charts-grid"><section className="chart-card surface"><div className="chart-title"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>Postings by day</h2></div><Activity size={18} /></div><div className="bar-chart">{(data?.postingsByDay || []).map((m, i) => <div className="bar-item" key={`${m.label}-${i}`}><span className="bar-value font-mono">{m.value}</span><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(5, (m.value / maxDay) * 100)}%` }} /></div><span className="bar-label">{m.label}</span></div>)}</div></section>
      <section className="chart-card surface"><div className="chart-title"><div><div className="eyebrow">WHERE ROLES COME FROM</div><h2>Top companies</h2></div><Building2 size={18} /></div><div className="rank-list">{(data?.topCompanies || []).map((m, i) => <div className="rank-row" key={`${m.label}-${i}`}><span className="rank-number font-mono">0{i + 1}</span><span className="rank-name">{m.label}</span><div className="rank-track"><span style={{ width: `${(m.value / maxCompany) * 100}%` }} /></div><span className="rank-value font-mono">{m.value}</span></div>)}</div></section>
      <section className="chart-card surface"><div className="chart-title"><div><div className="eyebrow">WHEN TO LOOK</div><h2>Posting hours</h2></div><Clock3 size={18} /></div><div className="hour-list">{(data?.postingHours || []).map((m, i) => <div className="hour-row" key={`${m.label}-${i}`}><span>{m.label}</span><div className="hour-track"><span style={{ width: `${(m.value / maxHour) * 100}%` }} /></div><span className="font-mono">{m.value}</span></div>)}</div></section>
      <section className="chart-card surface"><div className="chart-title"><div><div className="eyebrow">WHAT IS OPEN</div><h2>Roles by experience level</h2></div><GraduationCap size={18} /></div><div className="hour-list">{(data?.byLevel || []).map((m, i) => <div className="hour-row" key={`${m.label}-${i}`}><span>{levelLabel(m.label)}</span><div className="hour-track"><span style={{ width: `${(m.value / maxLevel) * 100}%` }} /></div><span className="font-mono">{m.value}</span></div>)}</div></section>
      <section className="insight-aside"><div className="aside-mark"><Sparkles size={18} /></div><div><h2>Use it as a guide.</h2><p>These counts come from the companies you follow, so they describe your list, not the whole job market.</p><span>BASED ON YOUR COMPANIES</span></div></section></div>
  </div>;
}

function SettingsPage({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) {
  const { user } = useUser();
  const client = useQueryClient();
  const dashboard = useGetDashboard();
  const profile = useGetProfile();
  const saveProfile = useUpdateProfile();
  const chooseLevel = (experienceLevel: string) => saveProfile.mutate({ data: { experienceLevel: experienceLevel as any } }, { onSuccess: () => void client.invalidateQueries({ queryKey: getGetProfileQueryKey() }) });
  return <div><PageHeading eyebrow="PREFERENCES" title="Settings." text="Your experience level, theme and account." />
    <section className="settings-section surface"><div className="settings-intro"><h2>Experience level</h2><p>The level your job feed starts on. You can change it any time from the feed.</p></div><div className="level-pills settings-levels" role="radiogroup" aria-label="Default experience level">{[{ value: 'any', label: 'Any level', hint: '' }, ...LEVELS].map(l => <button key={l.value} role="radio" aria-checked={profile.data?.experienceLevel === l.value} className={`level-pill ${profile.data?.experienceLevel === l.value ? 'level-pill-active' : ''}`} onClick={() => chooseLevel(l.value)} disabled={saveProfile.isPending} data-testid={`default-level-${l.value}`}>{l.label}<small>{l.hint.includes('years') ? l.hint : ''}</small></button>)}</div></section>
    <section className="settings-section surface"><div className="settings-intro"><h2>Appearance</h2><p>Light is the default. Dark is easier on the eyes at night.</p></div><div className="theme-options"><button className={`theme-option ${!dark ? 'theme-option-active' : ''}`} onClick={() => setDark(false)} data-testid="button-light-theme"><span className="theme-swatch light-swatch"><Sun size={18} /></span><strong>Coastal Study</strong><span>Warm light, quiet teal</span>{!dark && <Check size={16} className="option-check" />}</button><button className={`theme-option ${dark ? 'theme-option-active' : ''}`} onClick={() => setDark(true)} data-testid="button-dark-theme"><span className="theme-swatch dark-swatch"><Moon size={18} /></span><strong>Rainy Library</strong><span>Deep slate, sea glass</span>{dark && <Check size={16} className="option-check" />}</button></div></section>
    <section className="settings-section surface"><div className="settings-intro"><h2>Your account</h2><p>Account details managed securely through Google sign-in.</p></div><div className="account-detail"><div className="avatar large-avatar">{(user?.firstName?.[0] || user?.emailAddresses[0]?.emailAddress?.[0] || 'Y').toUpperCase()}</div><div><strong>{user?.fullName || user?.firstName || 'Your account'}</strong><span>{user?.primaryEmailAddress?.emailAddress || 'Signed in with Google'}</span></div><Badge tone="moss">Private</Badge></div></section>
    <section className="settings-section surface"><div className="settings-intro"><h2>Workspace summary</h2><p>A quick count of your data.</p></div>{dashboard.isLoading ? <div className="skeleton" /> : dashboard.isError ? <p className="muted">Summary is temporarily unavailable.</p> : <div className="settings-stats"><span><strong className="font-mono">{dashboard.data?.savedJobs ?? 0}</strong> saved roles</span><span><strong className="font-mono">{dashboard.data?.activeApplications ?? 0}</strong> active applications</span><span><strong className="font-mono">{dashboard.data?.followedCompanies ?? 0}</strong> followed companies</span></div>}</section>
    <div className="settings-footnote"><CircleHelp size={15} />Your list and applications are private to your account. Demo roles, if you load them, are marked as demo.</div>
  </div>;
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <WouterRouter base={basePath}><ClerkRoutes /></WouterRouter>;
}

export default App;