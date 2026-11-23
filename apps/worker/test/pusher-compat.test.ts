// Port of pusher-js spec/javascripts/integration/core/pusher_spec/test_builder.js
// against the realtime-hub worker's Pusher-compatible endpoints.
// Upstream: https://github.com/pusher/pusher-js — same `it` names and semantics.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type PusherClient from 'pusher-js';
import { newPusher, server, getRandomName, delay, waitsFor, subscribe, memberDataFor } from './helpers';

describe('Pusher (integration) with ws, forceTLS=false', () => {
  let pusher1: PusherClient;
  let pusher2: PusherClient;

  describe('setup', () => {
    it('should open connections', async () => {
      pusher1 = newPusher();
      pusher2 = newPusher();
      await waitsFor(() => pusher2.connection.state === 'connected', 'second connection to be established', 20_000);
      await waitsFor(() => pusher1.connection.state === 'connected', 'first connection to be established', 20_000);
    });
  });

  describe('with a public channel', () => {
    it('should subscribe and receive a message sent via REST API', async () => {
      const channelName = getRandomName('integration');
      const onSubscribed = vi.fn();
      const channel = subscribe(pusher1, channelName, onSubscribed);

      const eventName = 'integration_event';
      const data = { x: 1, y: 'z' };
      let received: any = null;

      await waitsFor(() => onSubscribed.mock.calls.length > 0, 'subscription to succeed', 10_000);
      channel.bind(eventName, (message: any) => { received = message; });
      await server().trigger(channelName, eventName, data);

      await waitsFor(() => received !== null, 'message to get delivered', 10_000);
      expect(received).toEqual(data);
      pusher1.unsubscribe(channelName);
    });

    it('should not receive messages after unsubscribing', async () => {
      const channelName = getRandomName('integration');
      const onSubscribed = vi.fn();
      const channel = subscribe(pusher1, channelName, onSubscribed);

      const eventName = 'after_unsubscribing';
      let received: any = null;

      await waitsFor(() => onSubscribed.mock.calls.length > 0, 'subscription to succeed', 10_000);
      channel.bind(eventName, (message: any) => { received = message; });
      pusher1.unsubscribe(channelName);
      await server().trigger(channelName, eventName, {});
      await delay(5_000);
      expect(received).toBe(null);
    });

    it('should handle unsubscribing as an idempotent operation', async () => {
      const channelName = getRandomName('integration');
      const onSubscribed = vi.fn();
      subscribe(pusher1, channelName, onSubscribed);

      await waitsFor(() => onSubscribed.mock.calls.length > 0, 'subscription to succeed', 10_000);
      pusher1.unsubscribe(channelName);
      pusher1.unsubscribe(channelName);
      pusher1.unsubscribe(channelName);
    });

    it('should handle cancelling pending subscription', async () => {
      const channelName = getRandomName('integration');
      const eventName = 'after_unsubscribing';
      let received: any = null;

      const channel = pusher1.subscribe(channelName);
      channel.bind(eventName, (message: any) => { received = message; });

      pusher1.unsubscribe(channelName);
      await waitsFor(() => !channel.subscriptionPending, 'subscription to succeed', 10_000);
      await server().trigger(channelName, eventName, {});
      await delay(5_000);

      expect(channel.subscribed).toEqual(false);
      expect(received).toBe(null);
    });

    it('should handle reinstating cancelled pending subscription', async () => {
      const channelName = getRandomName('integration');
      const eventName = 'after_subscribing';
      let received: any = null;

      const channel = pusher1.subscribe(channelName);
      channel.bind(eventName, (message: any) => { received = message; });

      pusher1.unsubscribe(channelName);
      pusher1.subscribe(channelName);
      await waitsFor(() => !channel.subscriptionPending, 'subscription to succeed', 10_000);
      await server().trigger(channelName, eventName, {});
      await delay(10_000);

      expect(channel.subscribed).toEqual(true);
      expect(received).not.toBe(null);
    });
  });

  function buildSubscriptionStateTests(getPusher: () => PusherClient, prefix: string) {
    it('sub-sub = sub', async () => {
      const pusher = getPusher();
      const channelName = getRandomName(prefix + 'integration');

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);
      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      await waitsFor(() => pusher.channel(channelName)!.subscribed, 'subscription to finish', 10_000);
      expect(pusher.channel(channelName)!.subscribed).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);
    });

    it('sub-wait-sub = sub', async () => {
      const pusher = getPusher();
      const channelName = getRandomName(prefix + 'integration');

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      await waitsFor(() => pusher.channel(channelName)!.subscribed, 'subscription to finish', 10_000);
      expect(pusher.channel(channelName)!.subscribed).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);
    });

    it('sub-unsub = NOP', async () => {
      const pusher = getPusher();
      const channelName = getRandomName(prefix + 'integration');

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      pusher.unsubscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(true);

      // there is no easy way to know when an unsubscribe request has been
      // actioned by the server, so we just wait a while
      await delay(5_000);

      expect(pusher.channel(channelName)).toBe(undefined);
    });

    it('sub-wait-unsub = NOP', async () => {
      const pusher = getPusher();
      const channelName = getRandomName(prefix + 'integration');

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      await waitsFor(() => pusher.channel(channelName)!.subscribed, 'subscription to finish', 10_000);
      expect(pusher.channel(channelName)!.subscribed).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      pusher.unsubscribe(channelName);
      expect(pusher.channel(channelName)).toBe(undefined);
    });

    it('sub-unsub-sub = sub', async () => {
      const pusher = getPusher();
      const channelName = getRandomName(prefix + 'integration');

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      pusher.unsubscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(true);

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      await waitsFor(() => pusher.channel(channelName)!.subscribed, 'subscription to finish', 10_000);
      expect(pusher.channel(channelName)!.subscribed).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);
    });

    it('sub-unsub-wait-sub = sub', async () => {
      const pusher = getPusher();
      const channelName = getRandomName(prefix + 'integration');

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      pusher.unsubscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(true);

      // there is no easy way to know when an unsubscribe request has been
      // actioned by the server, so we just wait a while
      await delay(5_000);
      expect(pusher.channel(channelName)).toBe(undefined);

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      await waitsFor(() => pusher.channel(channelName)!.subscribed, 'subscription to finish', 10_000);
      expect(pusher.channel(channelName)!.subscribed).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);
    });

    it('sub-unsub-unsub = NOP', async () => {
      const pusher = getPusher();
      const channelName = getRandomName(prefix + 'integration');

      pusher.subscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(false);

      pusher.unsubscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(true);

      pusher.unsubscribe(channelName);
      expect(pusher.channel(channelName)!.subscribed).toEqual(false);
      expect(pusher.channel(channelName)!.subscriptionPending).toEqual(true);
      expect(pusher.channel(channelName)!.subscriptionCancelled).toEqual(true);

      // there is no easy way to know when an unsubscribe request has been
      // actioned by the server, so we just wait a while
      await delay(5_000);

      expect(pusher.channel(channelName)).toBe(undefined);
    });
  }

  function buildClientEventsTests(getPusher1: () => PusherClient, getPusher2: () => PusherClient, prefix: string) {
    it('should receive a client event sent by another connection', async () => {
      const p1 = getPusher1();
      const p2 = getPusher2();
      const channelName = getRandomName(prefix + 'integration_client_events');

      const onSubscribed1 = vi.fn();
      const onSubscribed2 = vi.fn();
      const eventName = 'client-test';
      const data = { foo: 'bar' };
      const onEvent1 = vi.fn();
      const onEvent2 = vi.fn();

      subscribe(p1, channelName, onSubscribed1);
      subscribe(p2, channelName, onSubscribed2);

      await waitsFor(
        () => onSubscribed1.mock.calls.length > 0 && onSubscribed2.mock.calls.length > 0,
        'both connections to subscribe', 10_000,
      );

      p1.channel(channelName)!.bind(eventName, onEvent1);
      p2.channel(channelName)!.bind(eventName, onEvent2);
      (p1 as any).send_event(eventName, data, channelName);

      await waitsFor(() => onEvent2.mock.calls.length > 0, 'second connection to receive a message', 10_000);

      p1.unsubscribe(channelName);
      p2.unsubscribe(channelName);
    });

    it('should not receive a client event sent by itself', async () => {
      const pusher = getPusher1();
      const channelName = getRandomName(prefix + 'integration_client_events');
      const onSubscribed = vi.fn();
      const eventName = 'client-test';
      const onEvent = vi.fn();

      const channel = subscribe(pusher, channelName, onSubscribed);
      await waitsFor(() => onSubscribed.mock.calls.length > 0, 'connection to subscribe', 10_000);

      channel.bind(eventName, onEvent);
      (pusher as any).send_event(eventName, {}, channelName);
      await delay(5_000);

      expect(onEvent).not.toHaveBeenCalled();
      pusher.unsubscribe(channelName);
    });
  }

  describe('with a private channel', () => {
    buildSubscriptionStateTests(() => pusher1, 'private-');
    buildClientEventsTests(() => pusher1, () => pusher2, 'private-');
  });

  function buildPresenceChannelTests(getPusher1: () => PusherClient, getPusher2: () => PusherClient) {
    it("should get connection's member data", async () => {
      const pusher = getPusher1();
      const channelName = getRandomName('presence-integration_me');

      let members: any = null;
      subscribe(pusher, channelName, (_channel, ms) => { members = ms; });

      await waitsFor(() => members !== null, 'channel to subscribe', 10_000);

      expect(members.me).toEqual({
        id: pusher.connection.socket_id,
        info: {
          name: 'Integration ' + pusher.connection.socket_id,
          email: 'integration-' + pusher.connection.socket_id + '@example.com',
        },
      });
    });

    it('should receive a member added event', async () => {
      const p1 = getPusher1();
      const p2 = getPusher2();
      const channelName = getRandomName('presence-integration_member_added');

      let member: any = null;
      subscribe(p1, channelName, (channel) => {
        channel.bind('pusher:member_added', (m: any) => { member = m; });
        subscribe(p2, channelName, () => {});
      });

      await waitsFor(() => member !== null, 'the member added event', 10_000);

      expect(member.id).toEqual(p2.connection.socket_id);
      expect(member).toEqual({
        id: p2.connection.socket_id,
        info: {
          name: 'Integration ' + p2.connection.socket_id,
          email: 'integration-' + p2.connection.socket_id + '@example.com',
        },
      });

      p1.unsubscribe(channelName);
      p2.unsubscribe(channelName);
    });

    it('should receive a member removed event', async () => {
      const p1 = getPusher1();
      const p2 = getPusher2();
      const channelName = getRandomName('presence-integration_member_removed');

      let member: any = null;
      subscribe(p2, channelName, (channel) => {
        channel.bind('pusher:member_added', () => {
          channel.bind('pusher:member_removed', (m: any) => { member = m; });
          p1.unsubscribe(channelName);
        });
        subscribe(p1, channelName, () => {});
      });

      await waitsFor(() => member !== null, 'the member removed event', 10_000);

      expect(member.id).toEqual(p1.connection.socket_id);
      expect(member).toEqual({
        id: p1.connection.socket_id,
        info: {
          name: 'Integration ' + p1.connection.socket_id,
          email: 'integration-' + p1.connection.socket_id + '@example.com',
        },
      });

      p2.unsubscribe(channelName);
    });

    it('should maintain correct members count', async () => {
      const p1 = getPusher1();
      const p2 = getPusher2();
      const channelName = getRandomName('presence-integration_member_count');

      const onSubscribed1 = vi.fn();
      const onSubscribed2 = vi.fn();
      const onMemberAdded = vi.fn();
      const onMemberRemoved = vi.fn();

      const channel1 = subscribe(p1, channelName, onSubscribed1) as any;
      expect(channel1.members.count).toEqual(0);

      await waitsFor(() => onSubscribed1.mock.calls.length > 0, 'first connection to subscribe', 10_000);

      expect(channel1.members.count).toEqual(1);
      channel1.bind('pusher:member_added', onMemberAdded);
      const channel2 = subscribe(p2, channelName, onSubscribed2) as any;

      await waitsFor(() => onSubscribed2.mock.calls.length > 0, 'second connection to subscribe', 10_000);

      expect(channel2.members.count).toEqual(2);

      await waitsFor(() => onMemberAdded.mock.calls.length > 0, 'member added event', 10_000);

      expect(channel1.members.count).toEqual(2);
      channel2.bind('pusher:member_removed', onMemberRemoved);
      p1.unsubscribe(channelName);

      await waitsFor(() => onMemberRemoved.mock.calls.length > 0, 'member removed event', 10_000);

      expect(channel2.members.count).toEqual(1);
    });

    it('should maintain correct members data', async () => {
      const p1 = getPusher1();
      const p2 = getPusher2();
      const channelName = getRandomName('presence-integration_member_count');

      const onSubscribed1 = vi.fn();
      const onSubscribed2 = vi.fn();
      const onMemberAdded = vi.fn();
      const onMemberRemoved = vi.fn();

      const member1 = {
        id: p1.connection.socket_id,
        info: {
          name: 'Integration ' + p1.connection.socket_id,
          email: 'integration-' + p1.connection.socket_id + '@example.com',
        },
      };
      const member2 = {
        id: p2.connection.socket_id,
        info: {
          name: 'Integration ' + p2.connection.socket_id,
          email: 'integration-' + p2.connection.socket_id + '@example.com',
        },
      };

      const channel1 = subscribe(p1, channelName, onSubscribed1) as any;

      await waitsFor(() => onSubscribed1.mock.calls.length > 0, 'first connection to subscribe', 10_000);

      expect(channel1.members.get(p1.connection.socket_id)).toEqual(member1);
      expect(channel1.members.get(p2.connection.socket_id)).toBe(null);
      expect(channel1.members.me).toEqual(member1);

      channel1.bind('pusher:member_added', onMemberAdded);
      const channel2 = subscribe(p2, channelName, onSubscribed2) as any;

      await waitsFor(() => onSubscribed2.mock.calls.length > 0, 'second connection to subscribe', 10_000);

      expect(channel2.members.get(p1.connection.socket_id)).toEqual(member1);
      expect(channel2.members.get(p2.connection.socket_id)).toEqual(member2);
      expect(channel2.members.me).toEqual(member2);

      await waitsFor(() => onMemberAdded.mock.calls.length > 0, 'member added event', 10_000);

      expect(channel1.members.get(p1.connection.socket_id)).toEqual(member1);
      expect(channel1.members.get(p2.connection.socket_id)).toEqual(member2);

      channel2.bind('pusher:member_removed', onMemberRemoved);
      p1.unsubscribe(channelName);

      await waitsFor(() => onMemberRemoved.mock.calls.length > 0, 'member removed event', 10_000);

      expect(channel2.members.get(p1.connection.socket_id)).toBe(null);
      expect(channel2.members.get(p2.connection.socket_id)).toEqual(member2);
    });
  }

  describe('with a presence channel', () => {
    buildSubscriptionStateTests(() => pusher1, 'presence-');
    buildClientEventsTests(() => pusher1, () => pusher2, 'presence-');
    buildPresenceChannelTests(() => pusher1, () => pusher2);
  });

  describe('teardown', () => {
    it('should disconnect second connection', () => {
      pusher2?.disconnect();
    });
    it('should disconnect first connection', () => {
      pusher1?.disconnect();
    });
  });

  void memberDataFor;
});
