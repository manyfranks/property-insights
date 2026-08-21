import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  deleteUserAssessmentState,
  getUserAssessmentState,
  isAssessmentStateId,
  updateUserAssessmentSubject,
  updateUserAssessmentView,
} from "@/lib/db/user-assessments";
import { parseAssessmentGoal, parseSubjectScope } from "@/lib/property-intelligence/journey";
import { authenticatedUserId } from "@/lib/security/authorization";

async function ownedRequest(req: Request): Promise<{
  userId: string;
  id: string;
} | NextResponse> {
  const { userId: authUserId } = await auth();
  const userId = authenticatedUserId(authUserId);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!isAssessmentStateId(id)) return NextResponse.json({ error: "Invalid assessment ID" }, { status: 400 });
  return { userId, id };
}

export async function GET(req: Request) {
  const owned = await ownedRequest(req);
  if (owned instanceof NextResponse) return owned;
  const assessment = await getUserAssessmentState(owned.userId, owned.id);
  if (!assessment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, assessment });
}

export async function PATCH(req: Request) {
  const owned = await ownedRequest(req);
  if (owned instanceof NextResponse) return owned;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let assessment = null;
  if (body.activeView != null) {
    const activeView = parseAssessmentGoal(body.activeView);
    if (!activeView) return NextResponse.json({ error: "Invalid active view" }, { status: 400 });
    assessment = await updateUserAssessmentView(owned.userId, owned.id, activeView);
  }

  if (body.subject != null) {
    if (typeof body.subject !== "object" || Array.isArray(body.subject)) {
      return NextResponse.json({ error: "Invalid subject" }, { status: 400 });
    }
    const rawSubject = body.subject as Record<string, unknown>;
    const scope = parseSubjectScope(rawSubject.scope);
    if (!scope || rawSubject.selectedBy !== "user_confirmation") {
      return NextResponse.json({ error: "Invalid confirmed subject" }, { status: 400 });
    }
    try {
      assessment = await updateUserAssessmentSubject(owned.userId, owned.id, {
        scope,
        unit: typeof rawSubject.unit === "string" ? rawSubject.unit : null,
        selectedBy: "user_confirmation",
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid confirmed subject" },
        { status: 400 }
      );
    }
  }

  if (!assessment) {
    if (body.activeView == null && body.subject == null) {
      return NextResponse.json({ error: "No supported update" }, { status: 400 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, assessment });
}

export async function DELETE(req: Request) {
  const owned = await ownedRequest(req);
  if (owned instanceof NextResponse) return owned;
  const deleted = await deleteUserAssessmentState(owned.userId, owned.id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: true });
}
