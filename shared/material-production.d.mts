export type ProductionDoc={id:string;title:string;category:string;content:string;requirementIds:string[];assetIds:string[];images:import('../src/art-assets').ArtFile[];createdAt:string;updatedAt:string};
export function validateProductionDocs(value:unknown):ProductionDoc[];
export const productionTemplate:string;
