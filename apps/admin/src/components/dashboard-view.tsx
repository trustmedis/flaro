import { useCallback, useEffect, useState } from 'react';
import {
  ArrowClockwiseIcon,
  BroadcastIcon,
  LightningIcon,
  PlugsConnectedIcon,
  UsersIcon,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { AreaChart } from '@/siteplane/components/area-chart';
import { Badge, BadgeDot } from '@/siteplane/components/badge';
import { Button } from '@/siteplane/components/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import { FeaturedIcon } from '@/siteplane/components/featured-icon';
import { Skeleton } from '@/siteplane/components/skeleton';
import { api } from '../api';
import type { LiveStatsResponse } from '../api';

const POLL_MS = 3000;
const TIMELINE_MINUTES = 60;

function toTimeline(buckets: Array<number>, key: string, now: number) {
  return buckets.map((count, i) => ({
    [key]: count,
    t: new Date(now - (TIMELINE_MINUTES - 1 - i) * 60_000),
  }));
}

interface DashboardViewProps {
  onError: (message: string) => void;
}

function MetricCard({ icon: Icon, label, tone, value }: {
  icon: PhosphorIcon;
  label: string;
  tone: 'accent' | 'neutral' | 'success' | 'warning';
  value: number | null;
}) {
  return (
    <Card>
      <CardPanel className="flex items-center gap-3">
        <FeaturedIcon tone={tone}>
          <Icon aria-hidden="true" />
        </FeaturedIcon>
        <div className="min-w-0">
          {value === null ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="font-semibold text-2xl tabular-nums">{value.toLocaleString()}</div>
          )}
          <div className="truncate text-muted-foreground text-sm">{label}</div>
        </div>
      </CardPanel>
    </Card>
  );
}

export function DashboardView({ onError }: DashboardViewProps) {
  const [stats, setStats] = useState<LiveStatsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setStats(await api<LiveStatsResponse>('/stats'));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [onError]);

  const manualRefresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load() sets state only after awaiting; the effect starts polling when the view mounts
    void load();
    const interval = setInterval(() => {
      if (!document.hidden) {void load();}
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const totals = stats?.totals;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Badge variant="success">
          <BadgeDot />
          Live
        </Badge>
        <span className="text-muted-foreground text-sm">
          {stats ? `Updated ${new Date(stats.at).toLocaleTimeString()}` : 'Connecting…'}
        </span>
        <Button
          className="ms-auto"
          loading={refreshing}
          onClick={manualRefresh}
          size="xs"
          variant="ghost"
        >
          <ArrowClockwiseIcon aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={PlugsConnectedIcon}
          label="Live connections"
          tone="success"
          value={totals?.connections ?? null}
        />
        <MetricCard
          icon={BroadcastIcon}
          label="Channels with traffic"
          tone="neutral"
          value={totals?.channels ?? null}
        />
        <MetricCard
          icon={UsersIcon}
          label="Channel subscriptions"
          tone="accent"
          value={totals?.subscribers ?? null}
        />
        <MetricCard
          icon={LightningIcon}
          label="Events per minute"
          tone="warning"
          value={totals?.eventsPerMinute ?? null}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Events per minute</CardTitle>
              <CardDescription>
                Published events across all applications, last {TIMELINE_MINUTES} minutes.
              </CardDescription>
            </div>
          </CardHeader>
          <CardPanel>
            <AreaChart
              curve="monotone"
              data={stats ? toTimeline(stats.totals.eventsTimeline, 'events', new Date(stats.at).getTime()) : []}
              height={200}
              label="Published events per minute"
              series={[{ key: 'events', label: 'Events' }]}
              x="t"
            />
          </CardPanel>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>New connections per minute</CardTitle>
              <CardDescription>
                Subscriber and Pusher connections opened, last {TIMELINE_MINUTES} minutes.
              </CardDescription>
            </div>
          </CardHeader>
          <CardPanel>
            <AreaChart
              curve="monotone"
              data={stats ? toTimeline(stats.totals.connectionsTimeline, 'connections', new Date(stats.at).getTime()) : []}
              height={200}
              label="New connections per minute"
              series={[{ key: 'connections', label: 'Connections' }]}
              x="t"
            />
          </CardPanel>
        </Card>
      </div>
    </div>
  );
}
