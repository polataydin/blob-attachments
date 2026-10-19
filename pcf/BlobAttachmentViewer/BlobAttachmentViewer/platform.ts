/**
 * Parts of the Power Apps client API this control relies on that are missing from
 * @types/powerapps-component-framework (1.3.x).
 *
 * Both exist at runtime in a model-driven app but are absent from the published
 * typings, so they are described here once and reached through a narrow, documented
 * cast rather than sprinkling `any` through the call sites.
 */

/** Describes one parameter of a Web API operation to `execute`. */
export interface ExecuteParameterType {
    typeName: string;
    /** OData structural property: 1 = PrimitiveType, 5 = EntityType. */
    structuralProperty: number;
}

/** The `getMetadata()` contract an `execute` request object must satisfy. */
export interface ExecuteRequestMetadata {
    /** Name of the property holding the bound entity, or null for a global action. */
    boundParameter: string | null;
    parameterTypes: Record<string, ExecuteParameterType>;
    /** 0 = Action, 1 = Function, 2 = CRUD. */
    operationType: number;
    operationName: string;
}

export interface ExecuteRequest {
    getMetadata(): ExecuteRequestMetadata;
}

/** `context.webAPI.execute`, which the typings omit. */
export interface WebApiWithExecute {
    execute(request: ExecuteRequest): Promise<Response>;
}

/** The record the control is hosted on — the email, for a subgrid on an email form. */
export interface HostRecord {
    entityTypeName: string;
    entityId: string;
}

interface ContextInfoShape {
    entityTypeName?: unknown;
    entityId?: unknown;
}

/**
 * Reaches `context.mode.contextInfo`, which identifies the record whose form hosts the
 * control. Absent in the test harness, which has no host record, so this returns
 * undefined there rather than throwing.
 */
export function readHostRecord(mode: ComponentFramework.Mode): HostRecord | undefined {
    const info = (mode as unknown as { contextInfo?: ContextInfoShape }).contextInfo;
    if (!info) {
        return undefined;
    }

    const { entityTypeName, entityId } = info;
    if (typeof entityTypeName !== "string" || typeof entityId !== "string") {
        return undefined;
    }
    if (entityTypeName.length === 0 || entityId.length === 0) {
        return undefined;
    }

    return { entityTypeName, entityId };
}

/** Narrows `context.webAPI` to the shape that includes `execute`. */
export function webApiWithExecute(webAPI: ComponentFramework.WebApi): WebApiWithExecute {
    return webAPI as unknown as WebApiWithExecute;
}
