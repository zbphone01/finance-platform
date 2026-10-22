import { sql } from "drizzle-orm";
import { billDetails } from "@db/schema";

const CLEANUP_CHUNK_SIZE = 5000;

export function chunkNumericIds(ids: number[], size = CLEANUP_CHUNK_SIZE) {
  const uniqueIds = Array.from(new Set(ids.map(Number).filter(Boolean)));
  const chunks: number[][] = [];
  for (let index = 0; index < uniqueIds.length; index += size) {
    chunks.push(uniqueIds.slice(index, index + size));
  }
  return chunks;
}

export async function clearBillDetailMatchResults(db: { execute: (query: any) => Promise<unknown> }, matchResultIds: number[]) {
  for (const chunk of chunkNumericIds(matchResultIds)) {
    await db.execute(sql`
      UPDATE ${billDetails}
      SET ${billDetails.matchResultId} = NULL
      WHERE ${billDetails.matchResultId} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
    `);
  }
}
