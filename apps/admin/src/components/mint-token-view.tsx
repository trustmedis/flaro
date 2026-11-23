import { useState } from 'react';
import type { FormEvent } from 'react';
import { CodeBlock } from '@/siteplane/components/code';
import { Button } from '@/siteplane/components/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import { Field, FieldDescription, FieldLabel } from '@/siteplane/components/field';
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
import { TagsInput } from '@/siteplane/components/tags-input';
import { mintSubscriberToken } from '../api';
import type { AdminApp } from '../api';

interface MintTokenViewProps {
  apps: Array<AdminApp>;
  appId: string;
  onAppIdChange: (id: string) => void;
  run: (fn: () => Promise<void>) => void;
}

export function MintTokenView({ apps, appId, onAppIdChange, run }: MintTokenViewProps) {
  const [secret, setSecret] = useState('');
  const [sub, setSub] = useState('user-1');
  const [channels, setChannels] = useState<Array<string>>(['public:*']);
  const [iss, setIss] = useState('');
  const [ttl, setTtl] = useState('300');
  const [minted, setMinted] = useState('');

  const appItems = apps.map((app) => ({ value: app.id, label: `${app.name} (${app.id})` }));

  function mint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(async () => {
      const token = await mintSubscriberToken(secret, {
        appId,
        sub,
        channels,
        iss: iss || `${appId}-backend`,
        aud: 'realtime-hub',
        ttl: Number(ttl),
      });
      setMinted(token);
    });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <div>
          <CardTitle>Mint subscriber token</CardTitle>
          <CardDescription>
            Sign a short-lived subscriber JWT with the application&apos;s token secret.
          </CardDescription>
        </div>
      </CardHeader>
      <CardPanel>
        <Form className="grid gap-4 sm:grid-cols-2" onSubmit={mint}>
          <Field className="sm:col-span-2" name="appId">
            <Select
              items={appItems}
              name="appId"
              onValueChange={(value) => onAppIdChange(String(value))}
              required
              value={appId || null}
            >
              <SelectLabel>Application</SelectLabel>
              <SelectTrigger>
                <SelectValue placeholder="Choose an application" />
              </SelectTrigger>
              <SelectPopup>
                {appItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
          <Field className="sm:col-span-2" name="tokenSecret">
            <FieldLabel>Token secret</FieldLabel>
            <Input
              onChange={(e) => setSecret(e.target.value)}
              required
              type="password"
              value={secret}
            />
          </Field>
          <Field name="sub">
            <FieldLabel>Subject</FieldLabel>
            <Input onChange={(e) => setSub(e.target.value)} required value={sub} />
          </Field>
          <Field name="channels">
            <FieldLabel>Channel patterns</FieldLabel>
            <TagsInput
              onValueChange={setChannels}
              placeholder="Add a pattern"
              value={channels}
            />
            <FieldDescription>
              Glob patterns such as public:* or presence-room-1.
            </FieldDescription>
          </Field>
          <Field name="iss">
            <FieldLabel>Issuer</FieldLabel>
            <Input
              onChange={(e) => setIss(e.target.value)}
              placeholder={`${appId || 'app'}-backend`}
              value={iss}
            />
          </Field>
          <Field name="ttl">
            <FieldLabel>TTL (seconds, ≤ 300)</FieldLabel>
            <Input
              max={300}
              min={1}
              onChange={(e) => setTtl(e.target.value)}
              required
              type="number"
              value={ttl}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="accent">Mint token</Button>
          </div>
        </Form>
        {minted ? (
          <div className="mt-5">
            <CodeBlock copyable mask size="sm" title="Subscriber token" value={minted} />
          </div>
        ) : null}
      </CardPanel>
    </Card>
  );
}
