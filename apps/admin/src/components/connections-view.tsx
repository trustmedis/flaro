import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwiseIcon, PlugsConnectedIcon } from '@phosphor-icons/react/dist/ssr';
import { Badge, BadgeDot } from '@/siteplane/components/badge';
import { Button } from '@/siteplane/components/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/siteplane/components/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/siteplane/components/table';
import { api } from '../api';
import type { ConnectionsResponse } from '../api';

const POLL_MS = 3000;

function formatConnectedAt(ts: number): string {
  if (!ts) {return '—';}
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) {return `${seconds}s ago`;}
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {return `${minutes}m ago`;}
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

interface ConnectionsViewProps {
  onError: (message: string) => void;
}

export function ConnectionsView({ onError }: ConnectionsViewProps) {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<ConnectionsResponse>('/connections'));
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

  const connections = data?.connections ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Badge variant="success">
          <BadgeDot />
          Live
        </Badge>
        <span className="text-muted-foreground text-sm">
          {data ? `Updated ${new Date(data.at).toLocaleTimeString()}` : 'Connecting…'}
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

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Connected clients</CardTitle>
            <CardDescription>
              {data === null
                ? 'Loading live connections…'
                : `${connections.length} open WebSocket${connections.length === 1 ? '' : 's'} across all applications`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardPanel className="p-0">
          <Table aria-label="Connected clients">
            <TableHeader>
              <TableHead id="connection" isRowHeader>Connection</TableHead>
              <TableHead id="app">Application</TableHead>
              <TableHead id="mode">Mode</TableHead>
              <TableHead id="host">Host</TableHead>
              <TableHead id="agent">User agent</TableHead>
              <TableHead id="channels">Channels</TableHead>
              <TableHead id="connected" align="end">Connected</TableHead>
            </TableHeader>
            <TableBody
              renderEmptyState={() => (
                <Empty className="px-6 py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PlugsConnectedIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No connected clients</EmptyTitle>
                    <EmptyDescription>
                      Connections appear here while subscriber or Pusher sockets are open.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            >
              {connections.map((conn) => (
                <TableRow
                  id={conn.connId}
                  key={`${conn.appId}:${conn.connId}`}
                  textValue={conn.connId}
                >
                  <TableCell>
                    <span className="font-mono text-xs">{conn.connId}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{conn.appName}</span>
                      <Badge variant="outline">{conn.environment}</Badge>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={conn.mode === 'pusher' ? 'accent' : 'secondary'}>
                      {conn.mode}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{conn.host || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-48 truncate text-muted-foreground text-xs"
                      title={conn.userAgent}
                    >
                      {conn.userAgent || '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex max-w-56 flex-wrap gap-1">
                      {conn.channels.length === 0
                        ? <span className="text-muted-foreground">—</span>
                        : conn.channels.map((ch) => (
                          <Badge key={ch} variant="outline">{ch}</Badge>
                        ))}
                    </span>
                  </TableCell>
                  <TableCell align="end">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatConnectedAt(conn.connectedAt)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardPanel>
      </Card>
    </div>
  );
}
