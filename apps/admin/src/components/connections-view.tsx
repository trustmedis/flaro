import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowClockwiseIcon, PaperPlaneTiltIcon, PlugsConnectedIcon } from '@phosphor-icons/react/dist/ssr';
import { Badge, BadgeDot } from '@/siteplane/components/badge';
import { Button } from '@/siteplane/components/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import { CodeBlock } from '@/siteplane/components/code';
import { CopyButton } from '@/siteplane/components/copy-button';
import {
  DataList,
  DataListItem,
  DataListLabel,
  DataListValue,
} from '@/siteplane/components/data-list';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/siteplane/components/empty-state';
import { Field, FieldLabel } from '@/siteplane/components/field';
import { Form } from '@/siteplane/components/form';
import { Input } from '@/siteplane/components/input';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  PaginationStatus,
} from '@/siteplane/components/pagination';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/siteplane/components/select';
import { Separator } from '@/siteplane/components/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/siteplane/components/table';
import { Textarea } from '@/siteplane/components/textarea';
import { api } from '../api';
import type { ConnectionsResponse, LiveConnection, ProbeResult } from '../api';

const POLL_MS = 3000;
const PAGE_SIZE = 10;

const connKey = (conn: Pick<LiveConnection, 'appId' | 'connId'>) => `${conn.appId}:${conn.connId}`;

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

function ProbePanel({ conn, onError }: { conn: LiveConnection; onError: (message: string) => void }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channel = String(form.get('channel') ?? '');
    const eventName = String(form.get('event') ?? '') || 'debug';
    let data: unknown;
    try {
      data = JSON.parse(String(form.get('data') ?? '') || '{}');
    } catch {
      setFieldError('Payload must be valid JSON.');
      return;
    }
    setFieldError(null);
    setSending(true);
    try {
      setResult(await api<ProbeResult>(`/apps/${conn.appId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ channel, event: eventName, data }),
      }));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  const frame = result ? (conn.mode === 'pusher' ? result.frames.pusher : result.frames.rth) : null;

  return (
    <div className="flex flex-col gap-3">
      <Form className="flex flex-col gap-3" onSubmit={(event) => { void submit(event); }}>
        <Field name="channel">
          <FieldLabel>Channel</FieldLabel>
          {conn.channels.length > 0 ? (
            <Select defaultValue={conn.channels[0]} items={conn.channels.map((ch) => ({ value: ch, label: ch }))} name="channel">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {conn.channels.map((ch) => (
                  <SelectItem key={ch} value={ch}>{ch}</SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : (
            <Input name="channel" placeholder="channel-name" required />
          )}
        </Field>
        <Field name="event">
          <FieldLabel>Event name</FieldLabel>
          <Input defaultValue="debug" required />
        </Field>
        <Field name="data">
          <FieldLabel>Payload (JSON)</FieldLabel>
          <Textarea className="font-mono text-xs" defaultValue='{"debug": true}' rows={3} />
          {fieldError ? <span className="text-destructive text-xs">{fieldError}</span> : null}
        </Field>
        <Button loading={sending} type="submit" variant="accent">
          <PaperPlaneTiltIcon aria-hidden="true" />
          Send to channel
        </Button>
      </Form>
      {result && frame ? (
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">
            Delivered to {result.delivered} socket{result.delivered === 1 ? '' : 's'} — frame sent to this {conn.mode} connection:
          </span>
          <CodeBlock copyable language="json" size="sm" value={JSON.stringify(JSON.parse(frame), null, 2)} />
        </div>
      ) : null}
    </div>
  );
}

function ConnectionDetail({ conn, missing, onError }: {
  conn: LiveConnection | null;
  missing: boolean;
  onError: (message: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Connection detail</CardTitle>
          <CardDescription>
            {conn ? 'Inspect this socket and probe its channels.' : 'Pick a row to inspect a socket.'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        {conn === null ? (
          <Empty className="px-4 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugsConnectedIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{missing ? 'Connection closed' : 'Nothing selected'}</EmptyTitle>
              <EmptyDescription>
                {missing
                  ? 'This socket disconnected since you selected it.'
                  : 'Click a connection in the table to see its details and probe its channels.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <DataList>
              <DataListItem>
                <DataListLabel>Connection ID</DataListLabel>
                <DataListValue className="flex items-center gap-1">
                  <span className="min-w-0 font-mono text-xs">{conn.connId}</span>
                  <CopyButton value={conn.connId} />
                </DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Application</DataListLabel>
                <DataListValue className="flex items-center gap-2">
                  {conn.appName}
                  <Badge variant="outline">{conn.environment}</Badge>
                </DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Mode</DataListLabel>
                <DataListValue>
                  <Badge variant={conn.mode === 'pusher' ? 'accent' : 'secondary'}>{conn.mode}</Badge>
                </DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Host</DataListLabel>
                <DataListValue>
                  <span className="font-mono text-xs">{conn.host || '—'}</span>
                </DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>User agent</DataListLabel>
                <DataListValue>
                  <span className="break-all text-xs">{conn.userAgent || '—'}</span>
                </DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Connected</DataListLabel>
                <DataListValue>
                  <span className="text-xs">
                    {conn.connectedAt ? `${new Date(conn.connectedAt).toLocaleString()} (${formatConnectedAt(conn.connectedAt)})` : '—'}
                  </span>
                </DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Channels</DataListLabel>
                <DataListValue>
                  <span className="flex flex-wrap gap-1">
                    {conn.channels.length === 0
                      ? <span className="text-muted-foreground">—</span>
                      : conn.channels.map((ch) => (
                        <Badge key={ch} variant="outline">{ch}</Badge>
                      ))}
                  </span>
                </DataListValue>
              </DataListItem>
            </DataList>
            <Separator />
            <div>
              <div className="mb-3 font-medium text-sm">Probe channel</div>
              <ProbePanel conn={conn} key={connKey(conn)} onError={onError} />
            </div>
          </>
        )}
      </CardPanel>
    </Card>
  );
}

export function ConnectionsView({ onError }: ConnectionsViewProps) {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
  const totalPages = Math.max(1, Math.ceil(connections.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = connections.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = selectedKey ? (connections.find((c) => connKey(c) === selectedKey) ?? null) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Badge variant="success">
          <BadgeDot />
          Live
        </Badge>
        <span className="text-muted-foreground text-sm">
          {data ? `Updated ${new Date(data.at).toLocaleString()}` : 'Connecting…'}
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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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
            <Table
              aria-label="Connected clients"
              onSelectionChange={(keys) => {
                if (keys === 'all') {return;}
                const next = [...keys][0];
                setSelectedKey(next === undefined ? null : String(next));
              }}
              selectedKeys={selectedKey === null ? new Set<string>() : new Set([selectedKey])}
              selectionMode="single"
            >
              <TableHeader>
                <TableHead id="connection" isRowHeader>Connection</TableHead>
                <TableHead id="app">Application</TableHead>
                <TableHead id="mode">Mode</TableHead>
                <TableHead id="host">Host</TableHead>
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
                {pageRows.map((conn) => (
                  <TableRow
                    id={connKey(conn)}
                    key={connKey(conn)}
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
                    <TableCell align="end">
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {formatConnectedAt(conn.connectedAt)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {connections.length > PAGE_SIZE ? (
              <div className="border-border border-t px-4 py-2">
                <Pagination className="mx-0 w-full justify-between">
                  <PaginationStatus page={currentPage} total={totalPages} />
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        disabled={currentPage <= 1}
                        onClick={() => setPage(currentPage - 1)}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage(currentPage + 1)}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            ) : null}
          </CardPanel>
        </Card>

        <ConnectionDetail
          conn={selected}
          missing={selectedKey !== null && selected === null}
          onError={onError}
        />
      </div>
    </div>
  );
}
