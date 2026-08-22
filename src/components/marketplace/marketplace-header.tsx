import Link from "next/link";

export function MarketplaceHeader() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="wordmark">LoopList</Link>
        <nav className="market-category-nav" aria-label="Marketplace categories">
          <Link href="/?category=electronics#browse-heading">Electronics</Link>
          <Link href="/?category=running_shoes#browse-heading">Running shoes</Link>
          <Link href="/?category=sneakers#browse-heading">Sneakers</Link>
        </nav>
        <nav className="header-actions" aria-label="Primary">
          <Link href="/#search">Search</Link>
          <Link href="/sell" className="sell-link">Sell</Link>
        </nav>
      </div>
    </header>
  );
}
