---------------------------- MODULE DOSubscribeRace ----------------------------
EXTENDS TLC

(***************************************************************************)
(* Race inside ApplicationDO (apps/worker/src/do/ApplicationDO.ts).        *)
(*                                                                         *)
(* handleSubscribe for a private channel with an `auth` param reaches      *)
(* `await this.appSecretKey()` (a D1 read) mid-handler (lines ~245-251)    *)
(* and suspends. The DO runtime then runs other handlers for the same       *)
(* connection: handleUnsubscribe (:272-278) and webSocketClose (:336-343)   *)
(* are fully synchronous. When the awaited call resolves, the suspended     *)
(* handler resumes and writes subscription state unconditionally            *)
(* (:263-269) — no recheck of the socket or of newer client intent.         *)
(*                                                                         *)
(* Variables:                                                             *)
(*   open    - socket alive; conn present in this.conns                     *)
(*   sub     - conn present in ConnState.subs (logical subscription)        *)
(*   idx     - connId present in channelIndex[ch] (fan-out index)           *)
(*   pending - "auth": a subscribe handler is suspended at the auth await   *)
(*   intent  - last client request the DO accepted: "sub" | "unsub"         *)
(*                                                                         *)
(* CONSTANT Rechecks - FALSE models the current code (commit is             *)
(* unconditional); TRUE models the fix (resume verifies the conn is still   *)
(* open and the last intent was still subscribe).                           *)
(***************************************************************************)

CONSTANT Rechecks

VARIABLES open, sub, idx, pending, intent
vars == <<open, sub, idx, pending, intent>>

TypeOK ==
    /\ open \in BOOLEAN
    /\ sub \in BOOLEAN
    /\ idx \in BOOLEAN
    /\ pending \in {"none", "auth"}
    /\ intent \in {"none", "sub", "unsub"}

Init ==
    /\ open = TRUE
    /\ sub = FALSE
    /\ idx = FALSE
    /\ pending = "none"
    /\ intent = "none"

(* handleSubscribe, private channel + auth param: reaches
   `await appSecretKey()` and suspends. ApplicationDO.ts:245-251. *)
SubscribeBegin ==
    /\ open
    /\ pending = "none"
    /\ pending' = "auth"
    /\ intent' = "sub"
    /\ UNCHANGED <<open, sub, idx>>

(* The await resolves; the handler resumes and runs the add block.
   Current code: unconditional (ApplicationDO.ts:263-269).
   Fix (Rechecks=TRUE): only commit if the socket is still open and the
   client's last intent is still subscribe. *)
SubscribeCommit ==
    /\ pending = "auth"
    /\ IF Rechecks
       THEN /\ open
            /\ intent = "sub"
            /\ sub' = TRUE
            /\ idx' = TRUE
       ELSE /\ sub' = TRUE
            /\ idx' = TRUE
    /\ pending' = "none"
    /\ UNCHANGED <<open, intent>>

(* handleUnsubscribe — synchronous; can run while a subscribe handler is
   suspended on the same socket. ApplicationDO.ts:272-278. *)
Unsubscribe ==
    /\ open
    /\ sub' = FALSE
    /\ idx' = FALSE
    /\ intent' = "unsub"
    /\ UNCHANGED <<open, pending>>

(* webSocketClose — synchronous; drops the conn and its channelIndex
   entries. A suspended handler is NOT cancelled. ApplicationDO.ts:336-343. *)
Close ==
    /\ open
    /\ open' = FALSE
    /\ sub' = FALSE
    /\ idx' = FALSE
    /\ UNCHANGED <<pending, intent>>

Next == SubscribeBegin \/ SubscribeCommit \/ Unsubscribe \/ Close

Spec == Init /\ [][Next]_vars

(* While the socket is open and no handler is suspended, the stored
   subscription must equal the last client intent. Violated: subscribe(auth)
   suspends -> unsubscribe lands -> suspended subscribe commits anyway. The
   conn ends "subscribed" although the last request was unsubscribe. *)
IntentRespected == (open /\ pending = "none") => (sub <=> intent = "sub")

(* A closed socket must never sit in channelIndex. Violated: subscribe(auth)
   suspends -> socket closes -> suspended subscribe commits a ghost index
   entry publishEvent will attempt to send on (ApplicationDO.ts:297-303). *)
NoGhostIndex == ~open => ~idx
=============================================================================
