/** Lean's arithmetic lemmas use propositional extensionality. */
export const inventoryAxioms = ["propext"];

/** A single-SKU inventory service. Each stock update completes without an await. */
export function inventoryHandler(allowBackorders = () => false) {
  let available = 10;
  return async (request: Request): Promise<Response> => {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/reservations"
    )
      return new Response("Not found", { status: 404 });
    const body: unknown = await request.json().catch(() => null);
    const requested =
      body && typeof body === "object" && "quantity" in body
        ? body.quantity
        : undefined;
    if (
      typeof requested !== "number" ||
      !Number.isSafeInteger(requested) ||
      requested <= 0
    )
      return Response.json(
        { error: "quantity must be a positive safe integer" },
        { status: 400 },
      );
    if (requested > available && !allowBackorders())
      return Response.json({ error: "insufficient stock" }, { status: 409 });
    available = Math.max(0, available - requested);
    return Response.json(
      { reserved: requested, remaining: available },
      { status: 201 },
    );
  };
}
