import { useState } from 'react';
import type { FormEvent } from 'react';
import { FolderIcon, WarningCircleIcon } from '@phosphor-icons/react/dist/ssr';
import { Alert, AlertDescription, AlertTitle } from '@/siteplane/components/alert';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/siteplane/components/alert-dialog';
import { Badge } from '@/siteplane/components/badge';
import { Button } from '@/siteplane/components/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import { CopyButton } from '@/siteplane/components/copy-button';
import {
  DataList,
  DataListItem,
  DataListLabel,
  DataListValue,
} from '@/siteplane/components/data-list';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerPopup,
  DetailDrawerTitle,
} from '@/siteplane/components/detail-drawer';
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
  Select,
  SelectItem,
  SelectLabel,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/siteplane/components/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/siteplane/components/table';
import { api } from '../api';
import type { AdminApp, Credential } from '../api';
import type { SecretValue } from './secret-dialog';

const ENVIRONMENTS = [
  { value: 'dev', label: 'dev' },
  { value: 'staging', label: 'staging' },
  { value: 'prod', label: 'prod' },
];

type AppDetail = { app: AdminApp; credentials: Array<Credential> };

interface ApplicationsViewProps {
  apps: Array<AdminApp>;
  refresh: () => Promise<void>;
  run: (fn: () => Promise<void>) => void;
  setSecret: (secret: SecretValue) => void;
  setActiveAppId: (id: string) => void;
}

function statusVariant(status: string): 'success' | 'error' | 'secondary' {
  if (status === 'active') {return 'success';}
  if (status === 'disabled' || status === 'revoked') {return 'error';}
  return 'secondary';
}

export function ApplicationsView({ apps, refresh, run, setSecret, setActiveAppId }: ApplicationsViewProps) {
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [disableTarget, setDisableTarget] = useState<AdminApp | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Credential | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');

  function manage(app: AdminApp) {
    run(async () => {
      setDetail(await api<AppDetail>(`/apps/${app.id}`));
      setActiveAppId(app.id);
    });
  }

  function createApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '');
    const environment = String(data.get('environment') ?? 'dev');
    run(async () => {
      const r = await api<{ id: string; tokenSecret: string }>('/apps', {
        method: 'POST',
        body: JSON.stringify({ name, environment }),
      });
      setSecret({ title: `tokenSecret for ${r.id}`, value: r.tokenSecret });
      form.reset();
    });
  }

  function confirmDisable() {
    if (!disableTarget) {return;}
    setPending(true);
    setActionError('');
    void (async () => {
      try {
        await api(`/apps/${disableTarget.id}/disable`, { method: 'POST' });
        setDisableTarget(null);
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    })();
  }

  function confirmRevoke() {
    if (!revokeTarget || !detail) {return;}
    const appId = detail.app.id;
    const keyId = revokeTarget.keyId;
    setPending(true);
    setActionError('');
    void (async () => {
      try {
        await api(`/apps/${appId}/credentials/${keyId}/revoke`, { method: 'POST' });
        setDetail(await api<AppDetail>(`/apps/${appId}`));
        setRevokeTarget(null);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Create application</CardTitle>
            <CardDescription>
              A new application gets its own token secret and credential space.
            </CardDescription>
          </div>
        </CardHeader>
        <CardPanel>
          <Form className="flex flex-wrap items-end gap-3" onSubmit={createApp}>
            <Field className="min-w-56 flex-1" name="name">
              <FieldLabel>Name</FieldLabel>
              <Input placeholder="orders-api" required />
            </Field>
            <Field className="w-40" name="environment">
              <Select defaultValue="dev" items={ENVIRONMENTS} name="environment">
                <SelectLabel>Environment</SelectLabel>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {ENVIRONMENTS.map((env) => (
                    <SelectItem key={env.value} value={env.value}>
                      {env.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Button type="submit" variant="accent">Create</Button>
          </Form>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Applications</CardTitle>
            <CardDescription>
              {apps.length} application{apps.length === 1 ? '' : 's'} registered
            </CardDescription>
          </div>
        </CardHeader>
        <CardPanel className="p-0">
          <Table aria-label="Applications">
            <TableHeader>
              <TableHead id="id" isRowHeader>ID</TableHead>
              <TableHead id="name">Name</TableHead>
              <TableHead id="environment">Environment</TableHead>
              <TableHead id="status">Status</TableHead>
              <TableHead id="actions" align="end">Actions</TableHead>
            </TableHeader>
            <TableBody
              renderEmptyState={() => (
                <Empty className="px-6 py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No applications yet</EmptyTitle>
                    <EmptyDescription>
                      Create an application above to start issuing credentials.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            >
              {apps.map((app) => (
                <TableRow key={app.id} id={app.id} textValue={app.name}>
                  <TableCell>
                    <span className="flex items-center gap-1 font-mono text-xs">
                      {app.id}
                      <CopyButton value={app.id} />
                    </span>
                  </TableCell>
                  <TableCell>{app.name}</TableCell>
                  <TableCell>{app.environment}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(app.status)}>{app.status}</Badge>
                  </TableCell>
                  <TableCell align="end">
                    <span className="flex justify-end gap-2">
                      <Button
                        onClick={() => manage(app)}
                        size="xs"
                        variant="outline"
                      >
                        Manage
                      </Button>
                      {app.status === 'active' ? (
                        <Button
                          onClick={() => { setActionError(''); setDisableTarget(app); }}
                          size="xs"
                          variant="outline-destructive"
                        >
                          Disable
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardPanel>
      </Card>

      <DetailDrawer
        onOpenChange={(open) => { if (!open) {setDetail(null);} }}
        open={detail !== null}
      >
        <DetailDrawerPopup>
          {detail ? (
            <>
              <DetailDrawerHeader>
                <DetailDrawerTitle>{detail.app.name}</DetailDrawerTitle>
                <DetailDrawerDescription>
                  {detail.app.environment} · {detail.app.status}
                </DetailDrawerDescription>
              </DetailDrawerHeader>
              <DetailDrawerBody>
                <DataList>
                  <DataListItem>
                    <DataListLabel>Application ID</DataListLabel>
                    <DataListValue className="flex items-center gap-1">
                      <span className="min-w-0 font-mono text-xs">{detail.app.id}</span>
                      <CopyButton value={detail.app.id} />
                    </DataListValue>
                  </DataListItem>
                  <DataListItem>
                    <DataListLabel>Environment</DataListLabel>
                    <DataListValue>{detail.app.environment}</DataListValue>
                  </DataListItem>
                  <DataListItem>
                    <DataListLabel>Status</DataListLabel>
                    <DataListValue>
                      <Badge variant={statusVariant(detail.app.status)}>{detail.app.status}</Badge>
                    </DataListValue>
                  </DataListItem>
                  <DataListItem>
                    <DataListLabel>Created</DataListLabel>
                    <DataListValue>
                      {new Date(detail.app.createdAt).toLocaleString()}
                    </DataListValue>
                  </DataListItem>
                </DataList>

                <h3 className="mt-5 mb-2 font-medium text-sm">Credentials</h3>
                <Table aria-label="Credentials" size="xs">
                  <TableHeader>
                    <TableHead id="keyId" isRowHeader>Key ID</TableHead>
                    <TableHead id="scopes">Scopes</TableHead>
                    <TableHead id="status">Status</TableHead>
                    <TableHead id="actions" align="end">Actions</TableHead>
                  </TableHeader>
                  <TableBody
                    renderEmptyState={() => (
                      <p className="p-4 text-center text-muted-foreground text-sm">
                        No credentials yet.
                      </p>
                    )}
                  >
                    {detail.credentials.map((credential) => (
                      <TableRow
                        id={credential.keyId}
                        key={credential.keyId}
                        textValue={credential.keyId}
                      >
                        <TableCell>
                          <span className="font-mono text-xs">{credential.keyId}</span>
                        </TableCell>
                        <TableCell>{credential.scopes.join(', ')}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(credential.status)}>
                            {credential.status}
                          </Badge>
                        </TableCell>
                        <TableCell align="end">
                          {credential.status === 'active' ? (
                            <Button
                              onClick={() => { setActionError(''); setRevokeTarget(credential); }}
                              size="xs"
                              variant="outline-destructive"
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DetailDrawerBody>
              <DetailDrawerFooter>
                <Button
                  onClick={() => run(async () => {
                    const r = await api<{ apiKey: string }>(
                      `/apps/${detail.app.id}/credentials`,
                      { method: 'POST', body: JSON.stringify({ scopes: ['events:publish'] }) },
                    );
                    setSecret({ title: 'New API key', value: r.apiKey });
                    setDetail(await api<AppDetail>(`/apps/${detail.app.id}`));
                  })}
                >
                  New credential
                </Button>
                <Button
                  onClick={() => run(async () => {
                    const r = await api<{ tokenSecret: string }>(
                      `/apps/${detail.app.id}/token-secret`,
                      { method: 'POST' },
                    );
                    setSecret({ title: 'Rotated tokenSecret', value: r.tokenSecret });
                  })}
                  variant="outline"
                >
                  Rotate token secret
                </Button>
              </DetailDrawerFooter>
            </>
          ) : null}
        </DetailDrawerPopup>
      </DetailDrawer>

      <AlertDialog
        onOpenChange={(open) => { if (!open && !pending) {setDisableTarget(null);} }}
        open={disableTarget !== null}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {disableTarget?.name}?</AlertDialogTitle>
            <div>
              <AlertDialogDescription>
                Subscribers and publishers of <span className="font-mono">{disableTarget?.id}</span> will
                lose access. Credentials stay on record.
              </AlertDialogDescription>
              {actionError ? (
                <Alert className="mt-3" variant="error">
                  <WarningCircleIcon aria-hidden="true" />
                  <AlertTitle>Couldn&apos;t disable the application</AlertTitle>
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={pending} render={<Button variant="ghost" />}>
              Cancel
            </AlertDialogClose>
            <Button loading={pending} onClick={confirmDisable} variant="destructive">
              Disable
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => { if (!open && !pending) {setRevokeTarget(null);} }}
        open={revokeTarget !== null}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke credential?</AlertDialogTitle>
            <div>
              <AlertDialogDescription>
                Publishers using <span className="font-mono">{revokeTarget?.keyId}</span> will be
                rejected immediately. This can&apos;t be undone.
              </AlertDialogDescription>
              {actionError ? (
                <Alert className="mt-3" variant="error">
                  <WarningCircleIcon aria-hidden="true" />
                  <AlertTitle>Couldn&apos;t revoke the credential</AlertTitle>
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={pending} render={<Button variant="ghost" />}>
              Cancel
            </AlertDialogClose>
            <Button loading={pending} onClick={confirmRevoke} variant="destructive">
              Revoke
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
