import type { Category, Listing, Money } from "./types";
export const categories: {value:"all"|Category;label:string}[]=[{value:"all",label:"All listings"},{value:"electronics",label:"Electronics"},{value:"running_shoes",label:"Running shoes"},{value:"sneakers",label:"Sneakers"}];
export const categoryLabel=(v:Category)=>categories.find(x=>x.value===v)?.label??v;
export const humanize=(v:string)=>v.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
export function filterListings(items:Listing[],query:string,category:"all"|Category){const q=query.trim().toLocaleLowerCase();return items.filter(x=>(category==="all"||x.category===category)&&(!q||[x.title,x.brand,x.model,x.description,x.seller.displayName].some(v=>v.toLocaleLowerCase().includes(q))))}
export function parseUsdcInput(input:string):string|null {if(!/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(input))return null;const [w,f=""]=input.split(".");const value=`${w}${f.padEnd(6,"0")}`.replace(/^0+(?=\d)/,"");return value==="0"?null:value}
export function formatUsdcAtomic(atomic:string):string {if(!/^(0|[1-9]\d*)$/.test(atomic))return "—";const p=atomic.padStart(7,"0");return `${p.slice(0,-6)}.${p.slice(-6)}`}
export const displayPrice=(m:Money)=>`${formatUsdcAtomic(m.atomicAmount)} USDC`;
export function displayListingPrice(money: Money): string {
  const exact = formatUsdcAtomic(money.atomicAmount);
  if (exact === "—") return exact;
  return `${exact.replace(/\.0{6}$/, "").replace(/(\.\d*?[1-9])0+$/, "$1")} USDC`;
}
export function idempotencyKey(prefix:string){return `${prefix}-${crypto.randomUUID()}`}
export function publicMediaUrl(listingId:string,photoId:string){return `/api/listings/${encodeURIComponent(listingId)}/media/${encodeURIComponent(photoId)}`}
export function friendlyError(status:number){if(status===404)return "We couldn’t find that listing.";if(status===413)return "One or more photos are too large.";if(status===415)return "Use JPEG, PNG, or WebP photos.";return "Something went wrong. Please try again."}
