import data from "./raw_notes.json";
import { generateNoteSamples, generateWeakv2Samples } from "./scripts/generate";
import { generateMaskedSummaries } from "./scripts/mask";
import { fetchPdfs } from "./scripts/pdf";
import { identifyReferences } from "./scripts/references";
import { getTotalSummaryTokens, summarizePdfs } from "./scripts/summarize";

async function reshapeData() {
  const reshaped: Record<string, string>[] = [];
  for (const {
    id,
    createdAt,
    digestSpan,
    digestStartDate,
    revision: { title, content },
  } of data) {
    let summary = content;
    if (digestSpan === "DAY") {
      const summaryEnd = content.slice(2).indexOf("##");
      summary = content.slice("## Highlights\n\n".length, summaryEnd);
    }
    reshaped.push({
      id,
      title,
      content,
      summary,
      digestSpan,
      digestStartDate,
      createdAt,
    });
  }

  await Bun.write("notes.json", JSON.stringify(reshaped, null, 2));
}

// await fetchPdfs();
// await summarizePdfs();
// await findSmallest();
// await generateNoteSamples();
// await identifyReferences();
// await generateMaskedSummaries();
// await generateWeakv2Samples();
await getTotalSummaryTokens();