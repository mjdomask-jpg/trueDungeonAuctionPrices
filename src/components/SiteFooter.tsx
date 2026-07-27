import { useAuctionData } from '../data/auctionDataContext';
import { latestPricedAuction } from '../lib/data';
import { fmtCentral, fmtCloseDateFull } from '../lib/format';
import { APP_VERSION } from '../version';

// Shared footer on every page: the site version (tied to features) plus a
// separate data-freshness line — when prices were last updated (build-time git
// date, rendered in US Central) and the most recent auction those prices come
// from. The two are independent: a code release bumps the version, a data
// re-export moves the freshness line.
export function SiteFooter() {
  const { sales, meta } = useAuctionData();
  const updated = fmtCentral(__PRICES_UPDATED__);
  const latest = latestPricedAuction(sales, meta);
  const closed = latest && fmtCloseDateFull(latest.closeDate);

  return (
    <footer className="site-footer">
      <p className="foot-version">True Dungeon Auction Prices · v{APP_VERSION}</p>
      <p className="foot-data">
        {updated && <>Prices updated {updated}</>}
        {updated && latest && <span className="foot-sep"> · </span>}
        {latest && (
          <>
            latest auction <span className="foot-num">#{latest.auctionNumber}</span>
            {latest.auctioneer && <> by {latest.auctioneer}</>}
            {closed && <>, closed <span className="foot-close">{closed}</span></>}
          </>
        )}
      </p>
    </footer>
  );
}
