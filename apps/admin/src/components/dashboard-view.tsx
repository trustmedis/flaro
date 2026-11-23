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

interface TimelineSeries { buckets: Array<number>; key: string }

function toSeries(at: string, series: Array<TimelineSeries>) {
  const now = new Date(at).getTime();
  return (series[0]?.buckets ?? []).map((_, i) => ({
    t: new Date(now - (TIMELINE_MINUTES - 1 - i) * 60_000),
    ...Object.fromEntries(series.map((s) => [s.key, s.buckets[i] ?? 0])),
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

function ChartCard({ data, description, formatValue, series, title }: {
  data: ReturnType<typeof toSeries>;
  description: string;
  formatValue?: (value: number) => string;
  series: Array<{ key: string; label: string }>;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardPanel>
        <AreaChart
          curve="monotone"
          data={data}
          formatValue={formatValue}
          height={200}
          label={title}
          palette={series.length > 1 ? 'categorical' : undefined}
          series={series}
          x="t"
        />
      </CardPanel>
    </Card>
  );
}

const MEGABYTE = 1_048_576;

function formatMegabytes(value: number): string {
  if (value === 0) {return '0 MB';}
  if (value >= 10) {return `${value.toFixed(1)} MB`;}
  if (value >= 0.1) {return `${value.toFixed(2)} MB`;}
  return `${value.toPrecision(2)} MB`;
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
          {stats ? `Updated ${new Date(stats.at).toLocaleString()}` : 'Connecting…'}
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
        <ChartCard
          data={stats ? toSeries(stats.at, [{ buckets: stats.totals.eventsTimeline, key: 'events' }]) : []}
          description={`Published events across all applications, last ${TIMELINE_MINUTES} minutes.`}
          series={[{ key: 'events', label: 'Events' }]}
          title="Events per minute"
        />
        <ChartCard
          data={stats ? toSeries(stats.at, [{ buckets: stats.totals.deliveredTimeline, key: 'delivered' }]) : []}
          description={`Event frames fanned out to subscribers, last ${TIMELINE_MINUTES} minutes.`}
          series={[{ key: 'delivered', label: 'Delivered' }]}
          title="Delivered events per minute"
        />
        <ChartCard
          data={stats ? toSeries(stats.at, [
            { buckets: stats.totals.bandwidthInTimeline.map((v) => v / MEGABYTE), key: 'in' },
            { buckets: stats.totals.bandwidthOutTimeline.map((v) => v / MEGABYTE), key: 'out' },
          ]) : []}
          description={`WebSocket megabytes in and out of all applications, last ${TIMELINE_MINUTES} minutes.`}
          formatValue={formatMegabytes}
          series={[{ key: 'in', label: 'In' }, { key: 'out', label: 'Out' }]}
          title="Bandwidth per minute (MB)"
        />
        <ChartCard
          data={stats ? toSeries(stats.at, [{ buckets: stats.totals.connectionsTimeline, key: 'connections' }]) : []}
          description={`Subscriber and Pusher connections opened, last ${TIMELINE_MINUTES} minutes.`}
          series={[{ key: 'connections', label: 'Connections' }]}
          title="New connections per minute"
        />
        <ChartCard
          data={stats ? toSeries(stats.at, [{ buckets: stats.totals.subscriptionsTimeline, key: 'subscriptions' }]) : []}
          description={`Channel subscriptions created, last ${TIMELINE_MINUTES} minutes.`}
          series={[{ key: 'subscriptions', label: 'Subscriptions' }]}
          title="New subscriptions per minute"
        />
        <ChartCard
          data={stats ? toSeries(stats.at, [{ buckets: stats.totals.disconnectionsTimeline, key: 'disconnections' }]) : []}
          description={`Connections closed or dropped, last ${TIMELINE_MINUTES} minutes.`}
          series={[{ key: 'disconnections', label: 'Disconnections' }]}
          title="Disconnections per minute"
        />
      </div>
    </div>
  );
}
