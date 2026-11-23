------------------------------- MODULE ApplicationDO -------------------------------
EXTENDS Integers, FiniteSets

(***************************************************************************)
(* Model of the Realtime Hub application Durable Object's subscription   *)
(* bookkeeping, per docs/prd/PRD-01 (FR-02 subscriptions, FR-04 wire      *)
(* protocol, FR-05 recovery) and docs/prd/PRD-02 (app isolation).         *)
(*                                                                        *)
(* Three stores mirror the real implementation:                           *)
(*   subs      - the logical subscription set <<conn, channel>> the       *)
(*               client successfully holds (the spec truth).              *)
(*   persisted - per-connection WebSocket attachment claims; the only     *)
(*               state that survives hibernation (PRD-01: attachments     *)
(*               must carry enough metadata to rebuild the in-memory      *)
(*               subscription index).                                     *)
(*   live      - the in-memory index the DO fans out over. Empty while    *)
(*               hibernated; rebuilt from persisted on Wake.              *)
(*   awake     - whether the DO is actively serving (FALSE = hibernated). *)
(*   violations- count of delivery mismatches observed at Publish.        *)
(*                                                                        *)
(* Publish requires awake: a publish RPC to a hibernated DO wakes it and *)
(* rebuilds live from attachments before fan-out. Wake is a separate     *)
(* step, so the ordering the property depends on is explicit in the      *)
(* model.                                                                 *)
(***************************************************************************)

CONSTANTS Conns, Channels

VARIABLES attached, subs, persisted, live, awake, violations

vars == <<attached, subs, persisted, live, awake, violations>>

ConnCh == Conns \X Channels

TypeOK ==
    /\ attached \subseteq Conns
    /\ subs \subseteq ConnCh
    /\ persisted \in [Conns -> SUBSET Channels]
    /\ live \subseteq ConnCh
    /\ awake \in BOOLEAN
    /\ violations \in Nat

Init ==
    /\ attached = {}
    /\ subs = {}
    /\ persisted = [c \in Conns |-> {}]
    /\ live = {}
    /\ awake = TRUE
    /\ violations = 0

(* Client completes the WebSocket upgrade; the DO accepts it with the
   Hibernation API. *)
Connect(c) ==
    /\ c \in Conns
    /\ c \notin attached
    /\ attached' = attached \cup {c}
    /\ persisted' = [persisted EXCEPT ![c] = {}]
    /\ UNCHANGED <<subs, live, awake, violations>>

(* Socket closes: the connection and everything keyed to it is gone. *)
Disconnect(c) ==
    /\ c \in attached
    /\ attached' = attached \ {c}
    /\ subs' = {p \in subs : p[1] # c}
    /\ live' = {p \in live : p[1] # c}
    /\ persisted' = [persisted EXCEPT ![c] = {}]
    /\ UNCHANGED <<awake, violations>>

(* Successful subscribe: logical set, attachment claims, and live index
   all update together. Repeated subscribe is the same action -- subs is a
   set, so a duplicate request changes nothing (idempotent by construction). *)
Subscribe(c, ch) ==
    /\ awake
    /\ c \in attached
    /\ ch \in Channels
    /\ <<c, ch>> \notin subs
    /\ subs' = subs \cup {<<c, ch>>}
    /\ live' = live \cup {<<c, ch>>}
    /\ persisted' = [persisted EXCEPT ![c] = persisted[c] \cup {ch}]
    /\ UNCHANGED <<attached, awake, violations>>

Unsubscribe(c, ch) ==
    /\ awake
    /\ c \in attached
    /\ <<c, ch>> \in subs
    /\ subs' = subs \ {<<c, ch>>}
    /\ live' = live \ {<<c, ch>>}
    /\ persisted' = [persisted EXCEPT ![c] = persisted[c] \ {ch}]
    /\ UNCHANGED <<attached, awake, violations>>

(* The DO hibernates: the in-memory index is dropped; socket attachments
   (persisted) retain each connection's subscription claims. *)
Hibernate ==
    /\ awake
    /\ awake' = FALSE
    /\ live' = {}
    /\ UNCHANGED <<attached, subs, persisted, violations>>

(* The DO wakes (publish RPC or inbound frame) and rebuilds the in-memory
   index from the attachments. *)
Wake ==
    /\ ~awake
    /\ awake' = TRUE
    /\ live' = {p \in ConnCh : p[1] \in attached /\ p[2] \in persisted[p[1]]}
    /\ UNCHANGED <<attached, subs, persisted, violations>>

(* Fan-out: every attached connection subscribed to ch in the LIVE index
   receives the event. violations counts how far actual delivery strays
   from the spec truth (subs restricted to attached connections). *)
Publish(ch) ==
    /\ awake
    /\ ch \in Channels
    /\ LET expected == {c \in attached : <<c, ch>> \in subs}
           actual   == {c \in attached : <<c, ch>> \in live}
       IN  /\ violations' = violations
              + Cardinality(expected \ actual)
              + Cardinality(actual \ expected)
           /\ UNCHANGED <<attached, subs, persisted, live, awake>>

(* Spec truth for the fan-out index while awake. *)
DesiredLive == {<<c, ch>> \in subs : c \in attached}

(* The attachment must always mirror the logical subscriptions of every
   attached connection -- this is what makes hibernation lossless. *)
PersistedMatchesDesired ==
    \A c \in attached : persisted[c] = {ch \in Channels : <<c, ch>> \in subs}

(* While awake, the fan-out index must equal the logical subscriptions. *)
LiveMatchesDesiredWhenAwake ==
    awake => live = DesiredLive

(* No publish ever delivered to the wrong set of connections. *)
NoDeliveryErrors == violations = 0

Next ==
    \/ \E c \in Conns : Connect(c)
    \/ \E c \in Conns : Disconnect(c)
    \/ \E c \in Conns, ch \in Channels : Subscribe(c, ch)
    \/ \E c \in Conns, ch \in Channels : Unsubscribe(c, ch)
    \/ Hibernate
    \/ Wake
    \/ \E ch \in Channels : Publish(ch)

Spec == Init /\ [][Next]_vars
================================================================================
