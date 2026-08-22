import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { AnalyzeInputSchema } from "@/lib/domain/schemas";
import { analyzeWorkflow } from "@/workflows/analyze-workflow";
import { putPrivateBlobJson } from "@/lib/server/blob-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = AnalyzeInputSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.issues.map((i) => i.message);
      return NextResponse.json(
        { error: "Invalid analysis request payload", details: errorMessages },
        { status: 400 }
      );
    }

    const { imagePaths } = parseResult.data;

    const run = await start(analyzeWorkflow, [imagePaths]);

    const markerPath = `run-metadata/${run.runId}.json`;
    await putPrivateBlobJson(markerPath, {
      runId: run.runId,
      kind: "analysis",
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        runId: run.runId,
        status: "started",
      },
      { status: 202 }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to initialize analysis workflow" },
      { status: 500 }
    );
  }
}
