--------------------------- MODULE ClientConnectRace ---------------------------
EXTENDS Integers

(***************************************************************************)
(* Race in RealtimeClient (packages/client/src/index.ts).                   *)
(*                                                                         *)
(* connect() (:128-133) dedupes only via connectPromise and the ws/state    *)
(* check — it never inspects reconnectTimer. scheduleReconnect's timer      *)
(* fires `this.doConnect()` directly (:230-233), bypassing connectPromise   *)
(* entirely. So a manual connect() during a pending reconnect plus the      *)
(* timer's own fire start two doConnect() calls; each does                  *)
(* `this.ws = new WebSocket(...)` (:141) and the second assignment          *)
(* overwrites the first — socket A keeps running, invisible to the client.  *)
(*                                                                         *)
(* Variables:                                                             *)
(*   inflight - doConnect attempts started, not yet resolved                *)
(*   live     - sockets that completed the handshake                        *)
(*   timer    - a reconnectTimer is pending                                 *)
(*   promise  - connectPromise is non-null                                  *)
(*                                                                         *)
(* CONSTANT TimerDedupes - FALSE models the current code: the timer calls   *)
(* doConnect() directly, bypassing connectPromise. TRUE models the fix:    *)
(* the timer calls connect() instead — which is deduped by connectPromise *)
(* from either direction. (A first model of the fix — connect() cancels   *)
(* the pending timer — was FALSIFIED by the checker: it leaves the order  *)
(* TimerFires -> ManualConnect still racing, since the timer's attempt    *)
(* never sets connectPromise.)                                          *)
(***************************************************************************)

CONSTANT TimerDedupes

VARIABLES inflight, live, timer, promise
vars == <<inflight, live, timer, promise>>

TypeOK ==
    /\ inflight \in 0..2
    /\ live \in 0..2
    /\ timer \in BOOLEAN
    /\ promise \in BOOLEAN

Init ==
    /\ inflight = 0
    /\ live = 1          \* start connected; the drop begins the race
    /\ timer = FALSE
    /\ promise = FALSE

(* Socket drops: onClose schedules a reconnect (explicit-disconnect path
   omitted — it cancels the timer and ends the model). index.ts:206-215. *)
SocketDrops ==
    /\ live > 0
    /\ live' = live - 1
    /\ timer' = TRUE
    /\ UNCHANGED <<inflight, promise>>

(* reconnectTimer fires. Current code: calls doConnect() with NO guard on
   live sockets, connectPromise, or in-flight attempts. index.ts:230-233.
   Fix (TimerDedupes=TRUE): timer calls connect(), which early-returns
   when a socket is already live and returns the existing promise when a
   connect is in flight — so the timer can never start a second attempt.
   (The checker also falsified the weaker "timer only dedupes via
   promise" fix: ManualConnect -> AttemptOpens clears promise before the
   stale timer fires, letting it start a second socket on a live conn.) *)
TimerFires ==
    /\ timer
    /\ timer' = FALSE
    /\ IF TimerDedupes
       THEN IF promise \/ live > 0
            THEN UNCHANGED <<inflight, promise>>
            ELSE /\ inflight < 2
                 /\ inflight' = inflight + 1
                 /\ promise' = TRUE
       ELSE /\ inflight < 2
            /\ inflight' = inflight + 1
            /\ UNCHANGED <<promise>>
    /\ UNCHANGED <<live>>

(* User calls connect() while a reconnect is pending: the ws guard passes
   (this.ws is null) and connectPromise is null, so a new doConnect starts.
   index.ts:128-133. *)
ManualConnect ==
    /\ ~promise
    /\ live = 0
    /\ inflight < 2
    /\ promise' = TRUE
    /\ UNCHANGED <<timer>>
    /\ inflight' = inflight + 1
    /\ UNCHANGED <<live>>

(* An in-flight doConnect finishes the handshake. index.ts:140-165. *)
AttemptOpens ==
    /\ inflight > 0
    /\ inflight' = inflight - 1
    /\ live' = live + 1
    /\ promise' = FALSE
    /\ UNCHANGED <<timer>>

(* An attempt fails; its catch schedules a fresh reconnect. index.ts:232. *)
AttemptFails ==
    /\ inflight > 0
    /\ inflight' = inflight - 1
    /\ promise' = FALSE
    /\ timer' = TRUE
    /\ UNCHANGED <<live>>

Next == SocketDrops \/ TimerFires \/ ManualConnect \/ AttemptOpens \/ AttemptFails

Spec == Init /\ [][Next]_vars

(* At most one connect attempt in flight. Violated: socket drops -> timer
   pending -> manual connect() starts attempt A -> timer fires and starts
   attempt B unchecked. *)
AtMostOneAttempt == inflight <= 1

(* At most one live socket. Same trace continued: both attempts open -> two
   live sockets; this.ws names only the second. *)
AtMostOneSocket == live <= 1
=============================================================================
