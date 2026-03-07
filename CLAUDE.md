# Next.js Pro Rules — Comprehensive Best Practices
> Stack: Next.js 15+ · App Router · TypeScript (strict) · Tailwind CSS · Drizzle ORM · Zod · TanStack Query · Zustand · React Hook Form · Biome

---

## 1. TypeScript

### Core Rules
- **Strict mode always on** — `"strict": true` in `tsconfig.json`
- `const` by default; `let` only when reassignment is needed; never `var`
- `interface` for object shapes (extendable); `type` for unions, intersections, mapped types
- Never use `any` — use `unknown` + type guards instead
- Use `satisfies` to validate objects against a type without widening
- Use `readonly` for arrays and properties that must not be mutated
- Explicit return types on all exported functions — never rely on inference
- Template literal types for string pattern validation: `` type Route = `/${string}` ``
- If a type is used across more than 2 files → move to `types/`; otherwise co-locate

```ts
// ✅ Good
const config = { theme: "dark", lang: "en" } satisfies AppConfig;

// ✅ Result type — force callers to handle both cases
type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export async function getUser(id: string): Promise<Result<User>> {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) return { ok: false, error: "User not found" };
    return { ok: true, data: user };
  } catch (err) {
    logger.error("getUser failed", { err, id });
    return { ok: false, error: "Internal error" };
  }
}

// ❌ Bad
const data: any = await fetch(...);
```

### Node.js Built-ins
- `node:` prefix for all built-ins: `node:fs`, `node:path`, `node:crypto`
- `fs/promises` over callback-based `fs`
- `structuredClone()` instead of `JSON.parse(JSON.stringify())`
- `crypto.randomUUID()` instead of `uuid` package
- `AbortController` for cancellable operations
- `--env-file` instead of `dotenv` (Node 20+)

---

## 2. Project Architecture

### Directory Structure
```
src/
├── app/                      # App Router — routing only
│   ├── (auth)/               # Route groups
│   ├── (dashboard)/
│   │   ├── error.tsx         # Segment error boundary
│   │   ├── loading.tsx       # Suspense fallback
│   │   └── not-found.tsx     # 404 per segment
│   ├── api/                  # Route Handlers
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── ui/                   # Atoms: Button, Input, Badge
│   ├── features/             # Organisms: UserTable, ProductGrid
│   └── layouts/              # Header, Sidebar, DashboardLayout
├── hooks/                    # Custom hooks (use*.ts)
├── lib/
│   ├── api/                  # API client (openapi-fetch instance)
│   ├── query-client.ts       # TanStack QueryClient config
│   └── utils.ts              # cn(), helpers
├── server/
│   ├── actions/              # Server Actions
│   ├── db/                   # Drizzle schema + client
│   └── services/             # Business logic (pure functions)
├── stores/                   # Zustand stores (feature-scoped)
├── types/                    # Shared TypeScript types
└── config/                   # App-wide constants
```

### Layering Rules
- `app/` is thin — only routing, layouts, page shells; no business logic
- Business logic lives in `server/services/`, never in components
- `components/ui/` atoms do not know features exist
- Features can use atoms; pages compose features
- One default export per file; filename matches export name
- Co-locate tests: `UserCard.tsx` → `UserCard.test.tsx`

---

## 3. Component Design

### Single Responsibility
Each component does **one thing**. If you need "and" to describe it — split it.

```tsx
// ❌ Bad — fetches + renders + handles modal
function UserDashboard() { /* 300 lines */ }

// ✅ Good
export default async function UserDashboard() {
  return (
    <DashboardLayout>
      <StatsPanel />
      <UserTable />
    </DashboardLayout>
  );
}
```

### When to Split
| Situation | Action |
|-----------|--------|
| Component > 150 lines | Split |
| Repeated >= 2 places | Move to `ui/` |
| Has distinct loading state | Split + wrap `<Suspense>` |
| Needs `useState`/`useEffect` | Isolate as Client leaf |
| Props drilling > 2 levels | Use composition / `children` |

### Slot Pattern for Flexible Layouts
```tsx
interface CardProps {
  header: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Card({ header, children, footer }: CardProps) {
  return (
    <div className="card">
      <div className="card-header">{header}</div>
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}
```

### Props Interface Convention
```tsx
interface UserCardProps {
  user: User;
  showEmail?: boolean;
}

export function UserCard({ user, showEmail = false }: UserCardProps) { ... }
```

---

## 4. Server vs Client Components

### Default to Server Components
Add `"use client"` **only** when you need:
- `useState`, `useEffect`, `useReducer`
- Browser APIs (`window`, `localStorage`)
- Event listeners / interactivity
- Third-party client-only libraries

### Push "use client" to the Leaf
```tsx
// ✅ Page = Server Component
async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await productService.getById(id);
  if (!product) notFound();
  return (
    <Layout>
      <ProductDetail product={product} />   {/* Server */}
      <AddToCartButton productId={id} />    {/* "use client" inside */}
    </Layout>
  );
}
```

- Never import `server-only` modules in Client Components
- Use the `server-only` package to enforce server boundaries

---

## 5. Data Fetching & Caching

### Server Components — Fetch Directly
```ts
// ✅ Parallel fetching
const [user, posts] = await Promise.all([
  getUser(userId),
  getPosts(userId),
]);
```

### Cache Strategy
```ts
fetch(url)                                       // Static (default)
fetch(url, { next: { revalidate: 3600 } })       // ISR — every hour
fetch(url, { cache: "no-store" })                // Dynamic — always fresh
fetch(url, { next: { tags: ["products"] } })     // Tag-based
revalidateTag("products")                        // Invalidate in Action
```

### Server Actions — Mutations
```ts
// server/actions/product.ts
"use server";

export async function createProduct(
  _: unknown,
  formData: FormData
): Promise<ActionResult<Product>> {
  const session = await auth();
  if (!session) return { ok: false, error: "Unauthorized" };

  const parsed = createProductSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0].message };
  }

  try {
    const product = await db.insert(products).values(parsed.data).returning();
    revalidatePath("/products");
    revalidateTag("products");
    return { ok: true, data: product[0] };
  } catch (err) {
    logger.error("createProduct failed", { err });
    return { ok: false, error: "Da co loi xay ra, thu lai sau" };
  }
}
```

---

## 6. State Management

### Decision Matrix
| Type | Tool |
|------|------|
| Server state (async, cacheable) | TanStack Query |
| Global UI (sidebar, theme, modal) | Zustand |
| URL state (filters, pagination) | `nuqs` |
| Form input + validation | React Hook Form + Zod |
| Local component state | `useState` / `useReducer` |
| Server-only read data | Server Component + `fetch` |

### TanStack Query
```ts
// Query keys — hierarchical, structured
export const queryKeys = {
  users: {
    all: ["users"] as const,
    list: (filters: UserFilters) => ["users", "list", filters] as const,
    detail: (id: string) => ["users", "detail", id] as const,
  },
};

// Custom hook — never fetch in useEffect
export function useUser(id: string) {
  return useQuery({
    queryKey: queryKeys.users.detail(id),
    queryFn: () => userService.getById(id),
    staleTime: 1000 * 60 * 5,
    retry: (count, error) => {
      if (error instanceof ApiError && error.status < 500) return false;
      return count < 3;
    },
  });
}

// Mutation with optimistic update
export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateUserDto) => userService.update(dto),
    onMutate: async (dto) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users.detail(dto.id) });
      const previous = queryClient.getQueryData(queryKeys.users.detail(dto.id));
      queryClient.setQueryData(queryKeys.users.detail(dto.id), dto);
      return { previous };
    },
    onError: (_, dto, ctx) => {
      queryClient.setQueryData(queryKeys.users.detail(dto.id), ctx?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

// Global error handler
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof ApiError && error.status >= 500) {
        toast.error("Loi server, thu lai sau");
      }
      logger.error("Query failed", { error, queryKey: query.queryKey });
    },
  }),
});
```

### Zustand — UI State Only
```ts
// stores/ui.store.ts — feature-scoped, never a God store
interface UIStore {
  sidebarOpen: boolean;
  theme: "light" | "dark";
  toggleSidebar: () => void;
  setTheme: (theme: "light" | "dark") => void;
}

export const useUIStore = create<UIStore>()(
  devtools(
    persist(
      (set) => ({
        sidebarOpen: true,
        theme: "light",
        toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
        setTheme: (theme) => set({ theme }),
      }),
      { name: "ui-store" }
    )
  )
);

// ✅ Selector — avoid re-renders
const sidebarOpen = useUIStore((s) => s.sidebarOpen);
```

### URL State — nuqs
```ts
// Filters, search, pagination -> URL (shareable, bookmarkable)
const [search, setSearch] = useQueryState("q");
const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
```

---

## 7. Error Handling

### Error Taxonomy
```
Errors
├── Expected   -> validation, not-found, unauthorized -> return Result type
├── Unexpected -> crash, DB down, network fail -> catch + log + fallback UI
└── Form       -> field validation -> React Hook Form + Zod field errors
```

### Server Actions — Return, Don't Throw
```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };
```

### API Routes — Consistent Shape
```ts
// lib/api-response.ts
export const apiResponse = {
  ok: <T>(data: T, status = 200) =>
    NextResponse.json({ data }, { status }),
  error: (message: string, status = 400) =>
    NextResponse.json({ error: message }, { status }),
  notFound: (resource = "Resource") =>
    NextResponse.json({ error: `${resource} not found` }, { status: 404 }),
  unauthorized: () =>
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  serverError: () =>
    NextResponse.json({ error: "Internal server error" }, { status: 500 }),
};
```

### Error Boundaries — Per Segment
```
app/
├── error.tsx           <- whole app fallback
├── not-found.tsx       <- whole app 404
└── (dashboard)/
    ├── error.tsx       <- dashboard-only crash
    └── users/
        ├── error.tsx   <- users-only crash
        └── not-found.tsx
```

```tsx
// error.tsx — must be "use client"
"use client";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("Unhandled error", { error });
  }, [error]);

  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

### Error Rules
- **Log server-side only** — never expose stack traces to client
- **Generic message** to client; full context in server logs
- **Don't retry 4xx** — only retry 5xx with exponential backoff
- **Don't swallow** errors silently — always log or propagate
- **One log per error** — log at the top boundary, not every layer
- **Wrap third-party exceptions** at module boundaries into domain error types

---

## 8. Form Handling

```ts
// schemas/user.schema.ts
export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email"),
  role: z.enum(["admin", "user"]),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;
```

```tsx
// "use client"
function CreateUserForm() {
  const form = useForm<CreateUserDto>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: "user" },
  });

  const { mutate, isPending } = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      form.reset();
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      toast.success("User created!");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.field) {
        form.setError(err.field as keyof CreateUserDto, { message: err.message });
      }
    },
  });

  return (
    <form onSubmit={form.handleSubmit((data) => mutate(data))}>
      <input {...form.register("name")} />
      {form.formState.errors.name && (
        <p>{form.formState.errors.name.message}</p>
      )}
      <button disabled={isPending}>
        {isPending ? "Saving..." : "Create user"}
      </button>
    </form>
  );
}
```

---

## 9. API Client from OpenAPI 3

### Setup
```bash
npm install openapi-fetch
npm install -D openapi-typescript

# package.json scripts
"api:gen": "openapi-typescript ./openapi.yaml -o src/types/api.d.ts"
```

### Client with Middleware
```ts
// lib/api/client.ts
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@/types/api";

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = await getAccessToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401) await refreshAccessToken();
    return response;
  },
};

export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL!,
});

apiClient.use(authMiddleware);
```

### Service Layer — Always Wrap the Client
```ts
// server/services/user.service.ts
export type User = components["schemas"]["User"];

export const userService = {
  async getAll(params?: { page?: number }) {
    const { data, error } = await apiClient.GET("/users", {
      params: { query: params },
    });
    if (error) throw new ApiError(error);
    return data;
  },

  async getById(id: string): Promise<User | null> {
    const { data, error } = await apiClient.GET("/users/{id}", {
      params: { path: { id } },
    });
    if (error) {
      if (error.status === 404) return null;
      throw new ApiError(error);
    }
    return data;
  },
};
```

### Rules
- **Never call `apiClient` directly in components** — always through service layer
- **Commit generated types** to git — CI doesn't re-gen on every build
- **Never edit generated files** — re-run `api:gen` when spec changes
- **Orval** as alternative if you want auto-generated TanStack Query hooks

---

## 10. Database — Drizzle ORM

```ts
// server/db/schema/users.ts
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["admin", "user"] }).default("user"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

```ts
// Type-safe queries
const user = await db.query.users.findFirst({
  where: eq(users.id, id),
  with: { posts: true },
});

// Transactions for atomic operations
const result = await db.transaction(async (tx) => {
  const [user] = await tx.insert(users).values(data).returning();
  await tx.insert(profiles).values({ userId: user.id });
  return user;
});
```

- `drizzle-kit push` for dev; `generate` + `migrate` for production
- `drizzle-zod` to generate Zod schemas from table definitions
- Prepared statements (`.prepare()`) for frequently executed queries
- Keep schema definitions close to domain — one schema file per feature

---

## 11. Validation — Zod

```ts
// Reusable validation helper
function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { ok: true; data: T } | { ok: false; errors: Record<string, string> } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };

  const errors = result.error.errors.reduce(
    (acc, err) => ({ ...acc, [err.path.join(".")]: err.message }),
    {} as Record<string, string>
  );
  return { ok: false, errors };
}
```

- `.parse()` throws on invalid; `.safeParse()` returns Result-like object
- `z.discriminatedUnion()` over `z.union()` — better error messages
- `z.preprocess()` for coercing query strings (string -> number/boolean)
- `z.transform()` for normalization (trim strings, parse dates)
- Validate at **all** system boundaries: API inputs, Server Actions, env vars

---

## 12. Styling — Tailwind CSS

```ts
// lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

```ts
// Component variants — cva
const buttonVariants = cva("rounded font-medium transition-colors", {
  variants: {
    variant: {
      primary: "bg-blue-600 text-white hover:bg-blue-700",
      ghost: "bg-transparent hover:bg-gray-100",
      destructive: "bg-red-600 text-white hover:bg-red-700",
    },
    size: {
      sm: "px-3 py-1.5 text-sm",
      md: "px-4 py-2",
      lg: "px-6 py-3 text-lg",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});
```

- `@apply` only as last resort — prefer utility classes in templates
- Design tokens in `tailwind.config.ts` — colors, spacing, fonts
- `dark:` variant for dark mode; `group-*` and `peer-*` for conditional styling
- Mobile-first: base styles first, then `sm:`, `md:`, `lg:` breakpoints

---

## 13. Performance

```tsx
// Images — always specify dimensions
<Image src="/hero.jpg" alt="Hero" width={1200} height={600} priority />

// Fonts — load once at root layout
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

// Dynamic import — defer heavy components
const HeavyChart = dynamic(() => import("@/components/HeavyChart"), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});
```

- `React.memo` only after profiling — not preemptively
- `useCallback` / `useMemo` only for referential stability in dep arrays
- Virtualize long lists with `@tanstack/virtual`
- `ANALYZE=true next build` before each release
- Target < 150KB JS for initial load (gzipped)

---

## 14. Security

```ts
// Every Server Action — validate session first
"use server";
export async function deletePost(postId: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized" };
  // proceed...
}
```

- `middleware.ts` for route-level auth guards
- Secrets in `.env.local` only — never commit
- Validate env vars at startup with `@t3-oss/env-nextjs`
- Parameterized queries via Drizzle — no SQL injection risk
- Security headers in `next.config.ts` (CSP, X-Frame-Options, HSTS)
- Never expose stack traces or internal error details to client

---

## 15. Linting & Formatting — Biome

```json
{
  "linter": { "rules": { "recommended": true } },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": { "enabled": true }
}
```

```bash
biome check --write .   # local dev — auto-fix
biome ci .              # CI — strict, no auto-fix, exits non-zero on violation
biome rage              # debug config issues
```

---

## 16. Testing

| Layer | Tool | Target |
|-------|------|--------|
| Unit | Vitest + Testing Library | 80%+ on `server/services/` |
| Integration | Vitest + MSW | API boundaries |
| E2E | Playwright | Critical user journeys |
| Visual | Storybook + Chromatic | UI components |

```ts
// Unit test — Arrange / Act / Assert
describe("userService.getById", () => {
  it("returns null when user not found", async () => {
    server.use(http.get("/users/:id", () => HttpResponse.json(null, { status: 404 })));
    const result = await userService.getById("non-existent");
    expect(result).toBeNull();
  });
});
```

- Mock at the network layer (MSW), not at the module level
- `data-testid` or accessible roles for E2E selectors — never CSS selectors
- Write failing test first when fixing a bug, then fix the code
- Parallelize E2E suites; block PR merges on E2E failures for critical paths
- `useInfiniteQuery` for paginated/infinite scroll with `getNextPageParam`

---

## 17. JSDoc — Google Style

```ts
/**
 * Retrieves a user by their unique identifier.
 *
 * @param id - The UUID of the user to retrieve.
 * @returns The user record, or null if not found.
 * @throws {ApiError} When the database is unavailable.
 *
 * @example
 * const user = await userService.getById("550e8400-e29b-41d4-a716-446655440000");
 */
export async function getById(id: string): Promise<User | null> { ... }
```

- JSDoc for every public module, class, function, and method
- `@param`, `@returns`, `@throws` sections on all public APIs
- Include `@example` for complex or non-obvious public APIs

---

## 18. CI/CD Checklist

```bash
tsc --noEmit          # TypeScript check
biome ci .            # Lint + format
vitest run            # Unit + integration
playwright test       # E2E
next build            # Production build check
```

```
.env.local        -> local dev (gitignored)
.env.test         -> test environment
.env.production   -> set in platform, never committed
```

- `NEXT_PUBLIC_` prefix for client-exposed vars only
- Validate all env vars at startup — fail fast, not at runtime

---

## 19. Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Component | PascalCase | `UserProfile.tsx` |
| Hook | camelCase, `use` prefix | `useAuth.ts` |
| Server Action | camelCase, verb first | `createUser.ts` |
| Utility | camelCase | `formatDate.ts` |
| Type / Interface | PascalCase | `UserProfile` |
| Constant | SCREAMING_SNAKE | `MAX_RETRY_COUNT` |
| Zustand store | camelCase + `Store` suffix | `useUIStore` |
| Route segment | kebab-case | `app/user-settings/` |
| Query key factory | camelCase object | `queryKeys.users.detail(id)` |

---

## 20. Anti-Patterns — Never Do

```ts
// TypeScript
// ❌ any — use unknown + type guards
// ❌ export default function() {} — always name exports
// ❌ Rely on inference for exported function return types

// Components
// ❌ Business logic in app/ pages — use server/services/
// ❌ "use client" at page level — push down to leaf
// ❌ Importing server/ modules in "use client" files
// ❌ Skipping loading.tsx and error.tsx for routes

// State
// ❌ useEffect to fetch server data — use TanStack Query or Server Component
// ❌ Sync server state into Zustand — double source of truth
// ❌ useEffect to sync state with state — derive instead
// ❌ God store — one Zustand for everything
// ❌ Context for high-frequency updates — full tree re-render

// Errors
// ❌ Swallow errors silently: try { } catch {}
// ❌ Log errors at every layer — log once at top boundary
// ❌ Expose stack traces or internal details to client
// ❌ Retry 4xx errors — only retry 5xx with exponential backoff

// API / DB
// ❌ Call apiClient directly in components — go through service layer
// ❌ Edit generated API type files — re-run api:gen script
// ❌ Over-fetching — select only needed fields from DB
// ❌ Mutating state directly — return new objects/arrays

// Forms
// ❌ useRouter().push() for form submissions — use Server Actions
```

---

## 21. Quick Decision Guides

### State
```
Data from server/API?
├── Next.js App Router, read-only -> Server Component + fetch
└── Client-side, mutation, cache -> TanStack Query

Related to URL (filters, search, page)? -> nuqs
Form input + validation? -> React Hook Form + Zod
Share across components (UI only)? -> Zustand
Single component only? -> useState / useReducer
```

### Component Split
```
Needs interactivity / browser API? -> "use client" (push to leaf)
Only renders data? -> Server Component
> 150 lines? -> Split
Used >= 2 places? -> Move to ui/
Needs independent loading? -> Split + <Suspense>
```

### Error
```
Expected (validation, 404, 401)? -> return { ok: false, error }
Unexpected (crash, DB down)? -> throw -> error.tsx catches
Form field error? -> React Hook Form setError()
```

### API Client
```
Type-safe fetch, lightweight? -> openapi-typescript + openapi-fetch
Want auto-generated TanStack Query hooks? -> orval
Already using axios? -> orval + custom axios instance
Need API mocks in tests? -> orval + MSW handlers
```

---

*Version 2.0 — Next.js 15 · App Router · 2025*
