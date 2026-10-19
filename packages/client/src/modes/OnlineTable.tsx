import { useEffect, useMemo, useState } from 'react';
import { type Action, type HandRecord, validate } from '@wildcard/engine';
import { FairnessPanel } from '../components/FairnessPanel.js';
import { TableView } from '../components/TableView.js';
import { useTable } from '../hooks/useTable.js';
import { createPeerLink } from '../net/peerLink.js';
import { GuestTransport } from '../transport/guest.js';
import { HostTransport } from '../transport/host.js';
import { resolveVariant } from '../rules/customVariants.js';
import type { TableSnapshot } from '../transport/types.js';
import { sessionId } from '../session.js';

export interface OnlineSettings {
  readonly role: 'host' | 'guest';
  readonly roomCode: string;
  readonly name: string;
  readonly chips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** host のとき、自分も席に着くか。false なら中立のディーラー。 */
  readonly hostPlays: boolean;
  readonly variantId: string;
}

interface OnlineTableProps {
  readonly settings: OnlineSettings;
  readonly onExit: () => void;
}

export function OnlineTable({ settings, onExit }: OnlineTableProps) {
  const transport = useMemo(() => {
    const link = createPeerLink({ role: settings.role });

    if (settings.role === 'host') {
      const variant = resolveVariant(settings.variantId);
      return new HostTransport({
        link,
        roomCode: settings.roomCode,
        hostName: settings.name,
        hostPlays: settings.hostPlays,
        startingChips: settings.chips,
        seatCount: 10,
        smallBlind: settings.smallBlind,
        bigBlind: settings.bigBlind,
        ...(variant ? { variant } : {}),
      });
    }

    return new GuestTransport({
      link,
      roomCode: settings.roomCode,
      name: settings.name,
      sessionId: sessionId(),
    });
  }, [settings]);

  useEffect(() => {
    void transport.start();
    return () => {
      if (transport instanceof HostTransport) transport.close();
      else transport.leave();
    };
  }, [transport]);

  const snapshot = useTable(transport);
  const isHost = transport instanceof HostTransport;

  const [dealing, setDealing] = useState(false);
  const [dealNote, setDealNote] = useState<string | null>(null);
  const [records, setRecords] = useState<readonly HandRecord[]>([]);
  const [revealed, setRevealed] = useState(false);

  // 配牌の記録は Transport の中で増えるので、画面が変わるたびに取り直す。
  useEffect(() => {
    setRecords(transport.fairnessRecords());
  }, [transport, snapshot, dealing, revealed]);

  /**
   * ハンドを開始する。
   *
   * host はすぐには配らない。秘密をコミットして全員の乱数を集めてから
   * seed を決めるので、ここは待ちが入る（詳細は HostTransport.startHand）。
   */
  const startHand = () => {
    if (!isHost) return;
    setDealing(true);
    setDealNote(null);
    void transport.startHand().then((result) => {
      setDealing(false);
      setDealNote(result.ok ? null : result.reason);
    });
  };

  const act = (action: Action) => transport.dispatch(action);

  const startRejection = !isHost
    ? null
    : dealing
      ? '全員の乱数を集めています…'
      : (dealNote ?? validate(transport.rawState(), { type: 'startHand', seed: 0 })?.reason ?? null);

  // オンラインでは自分の番のときだけ操作できる。
  const myId = snapshot.viewerId;
  const controllablePlayerId =
    myId !== null && snapshot.state.turnPlayerId === myId ? myId : null;

  return (
    <TableView
      snapshot={snapshot}
      title={isHost ? (settings.hostPlays ? 'オンライン（host）' : 'オンライン（ディーラー）') : 'オンライン'}
      subtitle={<RoomCode code={settings.roomCode} />}
      onExit={onExit}
      onAction={act}
      controllablePlayerId={controllablePlayerId}
      onStartHand={isHost ? startHand : null}
      startRejection={startRejection}
      banner={
        <>
          <ConnectionBanner snapshot={snapshot} isHost={isHost} hostPlays={settings.hostPlays} />
          <div className="rule-bar">
            <FairnessPanel
              records={records}
              selfPlayerId={isHost ? null : transport.selfPlayerId()}
              expectedNonceCount={Math.max(0, snapshot.state.players.length - (settings.hostPlays ? 1 : 0))}
              onReveal={
                isHost
                  ? () => {
                      transport.revealAll();
                      setRevealed(true);
                    }
                  : null
              }
              revealed={isHost ? revealed : records.some((r) => r.secret !== null)}
            />
          </div>
        </>
      }
    />
  );
}

function RoomCode({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <button type="button" className="room-code" onClick={copy} title="コードをコピー">
      {copied ? 'コピーしました' : code}
    </button>
  );
}

function ConnectionBanner({
  snapshot,
  isHost,
  hostPlays,
}: {
  readonly snapshot: TableSnapshot;
  readonly isHost: boolean;
  readonly hostPlays: boolean;
}) {
  const { status, note } = snapshot;

  if (status === 'connecting') {
    return <div className="banner banner-wait">接続しています…</div>;
  }
  if (status === 'disconnected') {
    return <div className="banner banner-warn">{note ?? '接続が切れました。'}</div>;
  }
  if (status === 'rejected' || status === 'closed') {
    return <div className="banner banner-warn">{note ?? '部屋から外れました。'}</div>;
  }

  // 誰の端末で進行しているかは常に見えるようにしておく。
  // host は全員のホールカードを計算できる立場なので、それを隠さない。
  if (isHost && hostPlays) {
    return (
      <div className="banner banner-note">
        あなたの端末で進行しています。あなたは全員の手札を計算できる立場です。
      </div>
    );
  }
  if (isHost) {
    return (
      <div className="banner banner-note">
        ディーラーとして進行中。席に着いていないので、あなたの画面に手札は出ません。
      </div>
    );
  }
  return (
    <div className="banner banner-note">
      {hostPlays ? 'host の端末で進行しています。' : '席を持たないディーラーが進行しています。'}
    </div>
  );
}
