import { ScrollIcon } from '@phosphor-icons/react/dist/ssr';
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
import type { AuditEntry } from '../api';

interface AuditLogViewProps {
  audit: Array<AuditEntry>;
}

export function AuditLogView({ audit }: AuditLogViewProps) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            Administrative actions recorded by the hub, newest last.
          </CardDescription>
        </div>
      </CardHeader>
      <CardPanel className="p-0">
        <Table aria-label="Audit log">
          <TableHeader>
            <TableHead id="time" isRowHeader>Time</TableHead>
            <TableHead id="actor">Actor</TableHead>
            <TableHead id="action">Action</TableHead>
            <TableHead id="application">Application</TableHead>
          </TableHeader>
          <TableBody
            renderEmptyState={() => (
              <Empty className="px-6 py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScrollIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No audit entries</EmptyTitle>
                  <EmptyDescription>
                    Actions on applications and credentials show up here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          >
            {audit.map((entry) => (
              <TableRow
                id={String(entry.id)}
                key={entry.id}
                textValue={`${entry.actor} ${entry.action}`}
              >
                <TableCell>
                  <span className="text-xs">{new Date(entry.timestamp).toLocaleString()}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs">{entry.actor}</span>
                </TableCell>
                <TableCell>{entry.action}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{entry.applicationId}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardPanel>
    </Card>
  );
}
