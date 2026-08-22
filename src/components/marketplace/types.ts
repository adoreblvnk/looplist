export type Category = "electronics" | "running_shoes" | "sneakers";
export type Condition = "new" | "like_new" | "very_good" | "good" | "acceptable" | "for_parts";
export interface Money { currency:"USDC"; network:"eip155:84532"; atomicAmount:string }
export interface Evidence { id:string; photoId:string; kind:"identity"|"accessory"|"condition"|"defect"; claim:string; confidence:"low"|"medium"|"high" }
export interface Assumption { id:string; field:string; value:string; confidence:"low"|"medium"|"high"; editable:true; verified:false; sellerEdited:boolean }
export interface Listing { listingId:string; title:string; description:string; category:Category; brand:string; model:string; condition:Condition; attributes:Record<string,string>; includedAccessories:string[]; visiblyMissingAccessories:string[]; evidence:Evidence[]; assumptions:Assumption[]; price:Money; status:"active"|"sold"; seller:{id:string;displayName:string;fictional:true}; photoIds:string[]; publishedAt:string }
export interface MediaReference { id:string; pathname:string; mediaType:"image"; mimeType:"image/jpeg"|"image/png"|"image/webp"; alt:string; width:number;height:number }
export interface Draft { title:string;description:string;category:Category;brand:string;model:string;condition:Condition;attributes:Record<string,string>;includedAccessories:string[];visiblyMissingAccessories:string[];evidence:Evidence[];assumptions:Assumption[] }
export interface Comparable {comparableId:string;title:string;condition:Condition;soldPrice:Money;similarityReason:string}
export interface AnalysisSuccess {
  runId: string;
  status: "succeeded";
  photoIds: string[];
  draft: Draft;
  priceRecommendation: {
    recommendedPrice: Money;
    minimumPrice: Money;
    maximumPrice: Money;
    comparables: Comparable[];
    strongestComparableIds: string[];
    rationale: string;
  };
}

export interface BuyerSearchMatch {
  rank: number;
  score: number;
  fitExplanation: string;
  visibleDefects: string[];
  evidence: Array<{ evidenceId: string; claim: string; confidence: "low" | "medium" | "high" }>;
  assumptions: Array<{ assumptionId: string; field: string; value: string; confidence: "low" | "medium" | "high" }>;
  listing: Listing;
}

export interface BuyerSearchResponse {
  searchId: string;
  query: string;
  createdAt: string;
  interpretedConstraints: {
    categories: Category[];
    maximumAtomicAmount: string | null;
    acceptableConditions: Condition[];
    requiredTerms: string[];
    excludedDefectTerms: string[];
  };
  matches: BuyerSearchMatch[];
}

export interface Receipt {
  receiptId:string; purchaseId:string; listingId:string; listingTitle:string;
  buyer:{id:"demo-buyer";displayName:"Alex Rivera";role:"buyer";fictional:true};
  seller:{id:string;displayName:string;role:"seller";fictional:true};
  buyerAddress:string; recipientAddress:string; amount:Money;
  x402PaymentReference:string; settlementTransaction:string; settledAt:string; status:"sold";
}
export interface CheckoutSnapshot {
  listingId:string;title:string;condition:Condition;conditionSummary:string;amount:Money;
  recipientAddress:string;network:"eip155:84532";chainId:84532;
  asset:"0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  reservationExpiresAt:string|null;
  status:"active"|"payment_pending"|"settlement_pending"|"reconciliation_failed"|"sold";
  receipt:Receipt|null;
}
