interface PassDeviceGateProps {
  readonly playerName: string;
  readonly onReveal: () => void;
}

/**
 * ホットシート（1台を回す）で手番が移ったときに挟む目隠し。
 *
 * この画面の下に卓を描かないのが肝心で、オーバーレイで覆うだけだと
 * DOM には次の人のホールカードが載ってしまう。手番が移った瞬間は
 * 卓そのものを描かず、本人が「見る」を押してから描き始める。
 */
export function PassDeviceGate({ playerName, onReveal }: PassDeviceGateProps) {
  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-label">次の手番</div>
        <div className="gate-name">{playerName}</div>
        <p className="gate-note">端末を渡してください。他の人は見ないように。</p>
        <button type="button" className="btn btn-primary btn-large" onClick={onReveal}>
          カードを見る
        </button>
      </div>
    </div>
  );
}
