import Link from "next/link";
export function MarketplaceHeader(){return <header className="site-header"><div className="header-inner"><Link href="/" className="wordmark">LoopList</Link><nav aria-label="Primary"><Link href="/">Browse</Link><Link href="/sell" className="sell-link">Sell</Link></nav></div></header>}
