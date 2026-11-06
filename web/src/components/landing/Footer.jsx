import Mark from "../Mark.jsx";

function Row({ k, v, href }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}

/** The page ends the way every answer does: with a receipt. */
export default function Footer() {
  return (
    <footer className="lp-foot">
      <div className="lp-receipt">
        <p className="lp-receipt-head">
          <span>
            <Mark size={19} />
            AskOnly
          </span>
          <span>Receipt</span>
        </p>
        <dl>
          <Row k="Documents sent" v="None" />
          <Row k="Read by" v="Intel TDX on 0G" href="https://0g.ai" />
          <Row k="Expires on" v="Arkiv" href="https://arkiv.network" />
          <Row k="Source" v="GitHub" href="https://github.com/DanishVahora/eth_global" />
          <Row k="Built at" v="ETHGlobal Mumbai 2026" />
        </dl>
        <p className="lp-receipt-end">This is everything you get. No document, no key, no figures.</p>
      </div>
    </footer>
  );
}
