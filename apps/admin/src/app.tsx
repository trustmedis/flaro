import { useCallback, useEffect, useState } from 'react';
import { SignInButton, useAuth, useUser } from '@clerk/clerk-react';
import {
  GaugeIcon,
  KeyIcon,
  LinkSimpleIcon,
  PlugsConnectedIcon,
  PulseIcon,
  RocketIcon,
  ScrollIcon,
  SquaresFourIcon,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { AccountCard } from '@/siteplane/components/account-card';
import type { AccountCardAccount } from '@/siteplane/components/account-card';
import { Avatar, AvatarFallback } from '@/siteplane/components/avatar';
import { Button } from '@/siteplane/components/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import {
  DashboardShell,
  DashboardShellHeader,
  DashboardShellHeaderTitle,
  DashboardShellInset,
  DashboardShellMain,
  DashboardShellPrimary,
  DashboardShellSidebar,
  DashboardShellSidebarHeader,
  DashboardShellSidebarTrigger,
} from '@/siteplane/components/dashboard-shell';
import {
  SidebarBrand,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/siteplane/components/sidebar';
import { Spinner } from '@/siteplane/components/spinner';
import { toastManager } from '@/siteplane/components/toast';
import { api, setTokenGetter } from './api';
import type { AdminApp, AuditEntry } from './api';
import { ApplicationsView } from './components/applications-view';
import { ConnectionsView } from './components/connections-view';
import { DashboardView } from './components/dashboard-view';
import { AuditLogView } from './components/audit-log-view';
import { MintTokenView } from './components/mint-token-view';
import { QuickStartView } from './components/quick-start-view';
import { SecretDialog } from './components/secret-dialog';
import type { SecretValue } from './components/secret-dialog';
import { TestConsoleView } from './components/test-console-view';

type View = 'dashboard' | 'applications' | 'connections' | 'mint' | 'console' | 'audit' | 'quickstart';

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: View; label: string; icon: PhosphorIcon }> }> = [
  {
    label: 'Manage',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: GaugeIcon },
      { id: 'applications', label: 'Applications', icon: SquaresFourIcon },
      { id: 'connections', label: 'Connections', icon: LinkSimpleIcon },
      { id: 'audit', label: 'Audit log', icon: ScrollIcon },
    ],
  },
  {
    label: 'Tools',
    items: [
      { id: 'mint', label: 'Mint token', icon: KeyIcon },
      { id: 'console', label: 'Test console', icon: PlugsConnectedIcon },
      { id: 'quickstart', label: 'Quick start', icon: RocketIcon },
    ],
  },
];

const VIEW_TITLES: Record<View, string> = {
  applications: 'Applications',
  connections: 'Connections',
  dashboard: 'Dashboard',
  mint: 'Mint token',
  console: 'Test console',
  audit: 'Audit log',
  quickstart: 'Quick start',
};

const notify = {
  error: (message: string) => toastManager.add({ title: message, type: 'error' }),
  info: (message: string) => toastManager.add({ title: message }),
};

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function App() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!isSignedIn) { setTokenGetter(null); return; }
    setTokenGetter(getToken);
  }, [isSignedIn, getToken]);

  const [view, setView] = useState<View>('dashboard');
  const [apps, setApps] = useState<Array<AdminApp>>([]);
  const [audit, setAudit] = useState<Array<AuditEntry>>([]);
  const [secret, setSecret] = useState<SecretValue | null>(null);
  const [activeAppId, setActiveAppId] = useState('');

  const logout = useCallback(() => {
    if (isSignedIn) { void signOut(); }
  }, [isSignedIn, signOut]);

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ apps: Array<AdminApp> }>('/apps');
      setApps(d.apps);
      const a = await api<{ entries: Array<AuditEntry> }>('/audit');
      setAudit(a.entries);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && /403|401/.test(error.message)) {logout();}
    }
  }, [logout]);

  // oxlint-disable-next-line react/set-state-in-effect -- refresh() sets state only after awaits; the effect syncs data when auth state changes
  useEffect(() => { if (isSignedIn) {void refresh();} }, [isSignedIn, refresh]);

  const run = (fn: () => Promise<void>) => {
    fn().then(refresh).catch((error: unknown) => {
      notify.error(error instanceof Error ? error.message : String(error));
    });
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner aria-label="Loading" size="lg" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div>
              <CardTitle>Realtime Hub</CardTitle>
              <CardDescription>
                Sign in to manage applications, credentials and tokens.
              </CardDescription>
            </div>
          </CardHeader>
          <CardPanel className="flex flex-col gap-3">
            <SignInButton mode="modal">
              <Button className="w-full" variant="accent">Sign in with Clerk</Button>
            </SignInButton>
            <p className="text-muted-foreground text-xs">
              Requires a Clerk token with an admin claim (JWT template
              realtime-admin, org role, or public_metadata.role).
            </p>
          </CardPanel>
        </Card>
      </div>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const name = user?.fullName ?? email;
  const account: AccountCardAccount = {
    email,
    id: user?.id ?? 'account',
    initials: initialsOf(name, email),
    name,
    src: user?.imageUrl,
  };

  return (
    <DashboardShell defaultOpen>
      <DashboardShellSidebar>
        <DashboardShellSidebarHeader>
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem expandTrigger>
              <SidebarBrand render={<a href="/admin/" />}>
                <Avatar aria-hidden="true" shape="square" size="2xs">
                  <AvatarFallback>
                    <PulseIcon aria-hidden="true" />
                  </AvatarFallback>
                </Avatar>
                Realtime Hub
              </SidebarBrand>
            </SidebarMenuItem>
          </SidebarMenu>
        </DashboardShellSidebarHeader>
        <SidebarContent>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      active={view === item.id}
                      onClick={() => setView(item.id)}
                      tooltip={item.label}
                    >
                      <item.icon aria-hidden="true" className="size-5 shrink-0" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <AccountCard
            accountId={account.id}
            accounts={[account]}
            onSignOut={logout}
          />
        </SidebarFooter>
      </DashboardShellSidebar>

      <DashboardShellInset>
        <DashboardShellHeader>
          <DashboardShellSidebarTrigger aria-label="Toggle sidebar" />
          <DashboardShellHeaderTitle>{VIEW_TITLES[view]}</DashboardShellHeaderTitle>
        </DashboardShellHeader>
        <DashboardShellPrimary aria-label={VIEW_TITLES[view]}>
          <DashboardShellMain className="flex flex-col gap-5 p-6">
            {view === 'dashboard' ? (
              <DashboardView onError={notify.error} />
            ) : null}
            {view === 'applications' ? (
              <ApplicationsView
                apps={apps}
                refresh={refresh}
                run={run}
                setActiveAppId={setActiveAppId}
                setSecret={setSecret}
              />
            ) : null}
            {view === 'mint' ? (
              <MintTokenView
                appId={activeAppId}
                apps={apps}
                onAppIdChange={setActiveAppId}
                run={run}
              />
            ) : null}
            {view === 'connections' ? <ConnectionsView onError={notify.error} /> : null}
            {view === 'console' ? <TestConsoleView appId={activeAppId} /> : null}
            {view === 'audit' ? <AuditLogView audit={audit} /> : null}
            {view === 'quickstart' ? <QuickStartView appId={activeAppId} /> : null}
          </DashboardShellMain>
        </DashboardShellPrimary>
      </DashboardShellInset>

      <SecretDialog onClose={() => setSecret(null)} secret={secret} />
    </DashboardShell>
  );
}
