import { NextRequest, NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { RunIdSchema, RunMarkerSchema, AnalyzeResponseDTOSchema } from "@/lib/domain/schemas";
import { getPrivateBlobJson } from "@/lib/server/blob-client";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;

    const runIdValidation = RunIdSchema.safeParse(runId);
    if (!runIdValidation.success) {
      return NextResponse.json(
        { error: "Invalid workflow run ID format" },
        { status: 400 }
      );
    }

    const validatedRunId = runIdValidation.data;
    const markerPath = `run-metadata/${validatedRunId}.json`;
    const rawMarker = await getPrivateBlobJson(markerPath);

    if (!rawMarker) {
      return NextResponse.json(
        { error: "Analysis workflow run not found" },
        { status: 404 }
      );
    }

    const markerValidation = RunMarkerSchema.safeParse(rawMarker);
    if (
      !markerValidation.success ||
      markerValidation.data.kind !== "analysis" ||
      markerValidation.data.runId !== validatedRunId
    ) {
      return NextResponse.json(
        { error: "Analysis workflow run not found" },
        { status: 404 }
      );
    }

    const run = getRun(validatedRunId);

    if (!(await run.exists)) {
      return NextResponse.json(
        { error: "Analysis workflow run not found" },
        { status: 404 }
      );
    }

    const status = await run.status;

    if (status === "completed") {
      const returnValue = await run.returnValue;
      const parseResult = AnalyzeResponseDTOSchema.safeParse(returnValue);

      if (!parseResult.success || parseResult.data.runId !== validatedRunId) {
        return NextResponse.json(
          { error: "Analysis workflow result integrity failure" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        status: "completed",
        result: parseResult.data,
      });
    }

    if (status === "failed") {
      return NextResponse.json(
        {
          status: "failed",
          error: "Analysis workflow run encountered an unrecoverable failure",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status,
      result: null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to query workflow run status" },
      { status: 500 }
    );
  }
}
