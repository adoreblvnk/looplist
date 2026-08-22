import Link from "next/link";

export function MarketplaceHeader() {
  return (
    <header className="site-header">
      <div className="header-primary">
        <div className="header-inner">
          <Link href="/" className="wordmark" aria-label="LoopList marketplace">LoopList</Link>
          <nav className="market-category-nav" aria-label="Marketplace navigation">
            <Link href="/#browse-heading">Browse</Link>
            <Link href="/#buyer-search-heading">Gemma search</Link>
          </nav>
          <nav className="header-actions" aria-label="Primary">
            <Link href="/sell" className="sell-link">Sell</Link>
          </nav>
        </div>
      </div>
      <div className="header-marketplace">
        <div className="header-search-row">
          <form className="market-search" action="/" method="get" role="search">
            <label className="sr-only" htmlFor="market-search">Search marketplace</label>
            <span aria-hidden="true">⌕</span>
            <input id="market-search" name="q" type="search" placeholder="Search listings, brands, or sellers" />
            <button type="submit">Search</button>
          </form>
          <nav className="market-layer-categories" aria-label="Product categories">
            <Link href="/?category=electronics#browse-heading">Electronics</Link>
            <Link href="/?category=running_shoes#browse-heading">Running shoes</Link>
            <Link href="/?category=sneakers#browse-heading">Sneakers</Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
