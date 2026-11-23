import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/siteplane/components/dialog';
import { CodeBlock } from '@/siteplane/components/code';
import { Button } from '@/siteplane/components/button';

export interface SecretValue {
  title: string;
  value: string;
}

interface SecretDialogProps {
  secret: SecretValue | null;
  onClose: () => void;
}

export function SecretDialog({ secret, onClose }: SecretDialogProps) {
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => { if (!open) {onClose();} }}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{secret?.title}</DialogTitle>
          <DialogDescription>
            Shown once — store it somewhere safe.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <CodeBlock copyable mask size="sm" value={secret?.value ?? ''} />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
