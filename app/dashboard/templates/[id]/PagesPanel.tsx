"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getTierFeatures } from "@/lib/subscription";

type SourceType = "BUILDER" | "RAW_UPLOAD";

type PageNode = {
	id: string;
	name: string;
	slug: string | null;
	parentId: string | null;
	order: number;
	updatedAt: string;
	sourceType: SourceType;
};

type Props = {
	templateId: string;
	subscriptionPlan: string;
	onNavigate: (pageId: string) => void;
};

function IconChevron({ open }: { open: boolean }) {
	return (
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>
			<path d="M9 6l6 6-6 6" />
		</svg>
	);
}

function IconPages() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
			<path d="M14 4v6h6" />
		</svg>
	);
}

function IconPlus() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
			<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
		</svg>
	);
}

function IconX() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
			<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

function IconCopy() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</svg>
	);
}

function IconTrash() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
		</svg>
	);
}

function IconUpload() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
			<path d="M12 19V5M5 12l7-7 7 7" />
		</svg>
	);
}

function IconSwitch() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
		</svg>
	);
}

function IconHome() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M3 11l9-8 9 8" /><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
		</svg>
	);
}

function IconEdit() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
		</svg>
	);
}

function IconSparkle() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
			<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
		</svg>
	);
}

function IconArrowRight() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
			<line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
		</svg>
	);
}

function slugify(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
}

/** Full path (e.g. "/blog/post-1") for a node, walking up the tree via parentId. */
function pathFor(id: string, byId: Map<string, PageNode>): string {
	const segments: string[] = [];
	let cursor: PageNode | undefined = byId.get(id);
	while (cursor && cursor.parentId) {
		if (cursor.slug) segments.unshift(cursor.slug);
		cursor = byId.get(cursor.parentId);
	}
	return "/" + segments.join("/");
}

/** Ancestor chain root→...→id (inclusive), for breadcrumbs. */
function ancestorChain(id: string, byId: Map<string, PageNode>): PageNode[] {
	const chain: PageNode[] = [];
	let cursor: PageNode | undefined = byId.get(id);
	while (cursor) {
		chain.unshift(cursor);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}
	return chain;
}

function descendantIds(id: string, childrenOf: Map<string | null, PageNode[]>): Set<string> {
	const result = new Set<string>();
	const stack = [...(childrenOf.get(id) ?? [])];
	while (stack.length > 0) {
		const node = stack.pop()!;
		result.add(node.id);
		stack.push(...(childrenOf.get(node.id) ?? []));
	}
	return result;
}

type DropZone = "before" | "after" | "inside";

export function PagesPanel({ templateId, subscriptionPlan, onNavigate }: Props) {
	const [pages, setPages] = useState<PageNode[] | null>(null);
	const [rootId, setRootId] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [manageOpen, setManageOpen] = useState(false);
	const [nudgeDismissed, setNudgeDismissed] = useState(false);
	const [domainPreview, setDomainPreview] = useState<string | null>(null);

	const isUltra = getTierFeatures(subscriptionPlan).multiPageSitesEnabled;

	async function loadTree() {
		try {
			const res = await fetch(`/api/templates/${templateId}/pages`);
			if (!res.ok) throw new Error("Failed to load pages.");
			const data = (await res.json()) as { rootId: string; pages: PageNode[] };
			setPages(data.pages);
			setRootId(data.rootId);
			setLoadError(null);
		} catch (err) {
			setLoadError(err instanceof Error ? err.message : "Failed to load pages.");
		}
	}

	useEffect(() => {
		void loadTree();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [templateId]);

	useEffect(() => {
		if (!rootId) return;
		fetch(`/api/v1/domains?templateId=${rootId}`)
			.then((r) => r.json())
			.then((d: { domains?: { domain: string }[] }) => {
				setDomainPreview(d.domains?.[0]?.domain ?? null);
			})
			.catch(() => {});
	}, [rootId]);

	const byId = useMemo(() => {
		const map = new Map<string, PageNode>();
		(pages ?? []).forEach((p) => map.set(p.id, p));
		return map;
	}, [pages]);

	const childrenOf = useMemo(() => {
		const map = new Map<string | null, PageNode[]>();
		(pages ?? []).forEach((p) => {
			const list = map.get(p.parentId) ?? [];
			list.push(p);
			map.set(p.parentId, list);
		});
		for (const list of map.values()) list.sort((a, b) => a.order - b.order);
		return map;
	}, [pages]);

	if (!pages || !rootId) {
		return null;
	}

	const breadcrumb = ancestorChain(templateId, byId);
	const subPageCount = pages.length - 1;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "0.75rem",
				padding: "0.55rem 1.1rem",
				borderBottom: "1px solid rgba(255,255,255,0.08)",
				background: "rgba(255,255,255,0.02)",
				flexShrink: 0,
				flexWrap: "wrap",
			}}
		>
			{/* Breadcrumb */}
			<div style={{ display: "flex", alignItems: "center", gap: "0.3rem", minWidth: 0, flexWrap: "wrap" }}>
				{breadcrumb.map((node, idx) => {
					const isLast = idx === breadcrumb.length - 1;
					return (
						<span key={node.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
							{idx > 0 && <span style={{ color: "rgba(240,242,255,0.25)", fontSize: "0.75rem" }}>/</span>}
							{isLast ? (
								<span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f2ff", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
									{idx === 0 && <IconHome />}{node.name}
								</span>
							) : (
								<button
									type="button"
									onClick={() => onNavigate(node.id)}
									style={{
										fontSize: "0.78rem", fontWeight: 500, color: "rgba(240,242,255,0.55)",
										background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit",
										display: "inline-flex", alignItems: "center", gap: "0.25rem",
									}}
								>
									{idx === 0 && <IconHome />}{node.name}
								</button>
							)}
						</span>
					);
				})}
				{domainPreview && (
					<span style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.3)", marginLeft: "0.4rem" }}>
						{domainPreview}{pathFor(templateId, byId)}
					</span>
				)}
			</div>

			{/* Actions */}
			<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
				{isUltra && subPageCount === 0 && !nudgeDismissed && (
					<span style={{
						display: "inline-flex", alignItems: "center", gap: "0.4rem",
						fontSize: "0.72rem", color: "var(--brand)", fontWeight: 600,
						background: "var(--brand-subtle)", padding: "0.3rem 0.6rem", borderRadius: 999,
					}}>
						Turn this into a multi-page site <IconArrowRight />
						<button
							type="button"
							onClick={() => setNudgeDismissed(true)}
							aria-label="Dismiss"
							style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", display: "flex", padding: 0 }}
						>
							<IconX />
						</button>
					</span>
				)}
				<button
					type="button"
					onClick={() => setManageOpen(true)}
					style={{
						display: "inline-flex", alignItems: "center", gap: "0.4rem",
						padding: "0.4rem 0.75rem", borderRadius: 8,
						border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
						color: "rgba(240,242,255,0.75)", cursor: "pointer", fontFamily: "inherit",
						fontSize: "0.78rem", fontWeight: 600,
					}}
				>
					<IconPages />
					Pages {subPageCount > 0 ? `(${subPageCount + 1})` : ""}
				</button>
			</div>

			{manageOpen && (
				<ManagePagesModal
					pages={pages}
					byId={byId}
					childrenOf={childrenOf}
					rootId={rootId}
					currentId={templateId}
					isUltra={isUltra}
					domainPreview={domainPreview}
					onClose={() => setManageOpen(false)}
					onNavigate={(id) => { setManageOpen(false); onNavigate(id); }}
					onReload={loadTree}
				/>
			)}

			{loadError && (
				<span style={{ fontSize: "0.72rem", color: "#f87171" }}>{loadError}</span>
			)}
		</div>
	);
}

function ManagePagesModal({
	pages,
	byId,
	childrenOf,
	rootId,
	currentId,
	isUltra,
	domainPreview,
	onClose,
	onNavigate,
	onReload,
}: {
	pages: PageNode[];
	byId: Map<string, PageNode>;
	childrenOf: Map<string | null, PageNode[]>;
	rootId: string;
	currentId: string;
	isUltra: boolean;
	domainPreview: string | null;
	onClose: () => void;
	onNavigate: (id: string) => void;
	onReload: () => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [addParentId, setAddParentId] = useState<string | null>(null);
	const [newPageName, setNewPageName] = useState("");
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameName, setRenameName] = useState("");
	const [renameSlug, setRenameSlug] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<PageNode | null>(null);
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [uploadParentId, setUploadParentId] = useState<string | null>(null);
	const [resetTarget, setResetTarget] = useState<PageNode | null>(null);
	// Holds the in-flight file when a quick upload hits the account's first-ever-raw-upload
	// AUP gate, so accepting inline can resubmit the exact same upload instead of losing it
	// and forcing a trip to a separate page.
	const [aupPending, setAupPending] = useState<{ parentId: string; file: File } | null>(null);
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const router = useRouter();

	async function createPage(parentId: string) {
		const name = newPageName.trim();
		if (!name) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/templates", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, parentId, slug: slugify(name) }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? "Unable to create page.");
			setNewPageName("");
			setAddParentId(null);
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to create page.");
		} finally {
			setBusy(false);
		}
	}

	function triggerUpload(parentId: string) {
		setUploadParentId(parentId);
		uploadInputRef.current?.click();
	}

	async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file || !uploadParentId) return;
		await doUpload(uploadParentId, file, false);
	}

	// Shared by the initial attempt and the AUP-acceptance retry — acceptAup is only ever
	// true on the retry, once the inline consent dialog below has been confirmed.
	async function doUpload(parentId: string, file: File, acceptAup: boolean) {
		setBusy(true);
		setError(null);
		try {
			const form = new FormData();
			form.append("file", file);
			form.append("parentId", parentId);
			if (acceptAup) form.append("acceptAup", "true");
			const res = await fetch("/api/v1/templates/upload-raw", { method: "POST", body: form });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				// First-ever raw upload on the account needs explicit consent — hold onto the
				// file and offer that consent inline rather than losing the upload.
				if (data.requiresAupAcceptance && !acceptAup) {
					setAupPending({ parentId, file });
					return;
				}
				throw new Error(data.error ?? "Unable to upload page.");
			}
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to upload page.");
		} finally {
			setBusy(false);
			setUploadParentId(null);
		}
	}

	async function confirmAupAndUpload() {
		if (!aupPending) return;
		const { parentId, file } = aupPending;
		setAupPending(null);
		await doUpload(parentId, file, true);
	}

	async function switchToRaw(id: string) {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/templates/${id}/eject`, { method: "POST" });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? "Unable to switch this page.");
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to switch this page.");
		} finally {
			setBusy(false);
		}
	}

	async function confirmResetToBuilder() {
		if (!resetTarget) return;
		const id = resetTarget.id;
		setResetTarget(null);
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/templates/${id}/reset-to-builder`, { method: "POST" });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? "Unable to switch this page.");
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to switch this page.");
		} finally {
			setBusy(false);
		}
	}

	async function submitRename(id: string) {
		const name = renameName.trim();
		const node = byId.get(id);
		if (!node) return;
		setBusy(true);
		setError(null);
		try {
			const payload: Record<string, unknown> = {};
			if (name && name !== node.name) payload.name = name;
			if (node.parentId !== null) {
				const slug = slugify(renameSlug);
				if (slug && slug !== node.slug) payload.slug = slug;
			}
			if (Object.keys(payload).length > 0) {
				const res = await fetch(`/api/templates/${id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(data.error ?? "Unable to save changes.");
			}
			setRenamingId(null);
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to save changes.");
		} finally {
			setBusy(false);
		}
	}

	async function duplicatePage(id: string) {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/templates/${id}/duplicate`, { method: "POST" });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? "Unable to duplicate page.");
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to duplicate page.");
		} finally {
			setBusy(false);
		}
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/templates/${deleteTarget.id}`, { method: "DELETE" });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? "Unable to delete page.");

			const wasCurrent = deleteTarget.id === currentId;
			const wasRoot = deleteTarget.parentId === null;
			const parentId = deleteTarget.parentId;
			setDeleteTarget(null);

			if (wasCurrent && wasRoot) {
				// The whole site (this page + every page nested under it) is gone —
				// there's nothing left here to reload or navigate to within the tree.
				// Refresh first so the prefetch-cached Templates list doesn't still show it.
				router.refresh();
				router.push("/dashboard/templates");
				return;
			}
			if (wasCurrent && parentId) {
				// The page being edited was deleted; its parent still exists, so
				// hop up to it rather than reloading a tree for a page that's gone.
				onNavigate(parentId);
				return;
			}
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to delete page.");
		} finally {
			setBusy(false);
		}
	}

	async function commitDrop(draggedId: string, targetId: string, zone: DropZone) {
		setDragId(null);
		setDropTarget(null);
		const dragged = byId.get(draggedId);
		const target = byId.get(targetId);
		if (!dragged || !target || draggedId === targetId) return;
		if (!dragged.parentId) return; // home can't move

		const forbidden = descendantIds(draggedId, childrenOf);
		forbidden.add(draggedId);
		if (forbidden.has(targetId) || (zone !== "inside" && !target.parentId)) return;

		const newParentId = zone === "inside" ? targetId : (target.parentId as string);
		const siblings = (childrenOf.get(newParentId) ?? []).filter((p) => p.id !== draggedId);
		let insertIndex = siblings.length;
		if (zone === "before") insertIndex = siblings.findIndex((p) => p.id === targetId);
		else if (zone === "after") insertIndex = siblings.findIndex((p) => p.id === targetId) + 1;
		if (insertIndex < 0) insertIndex = siblings.length;

		const ordered = [...siblings];
		ordered.splice(insertIndex, 0, dragged);

		setBusy(true);
		setError(null);
		try {
			const updates = ordered
				.map((node, idx) => ({ node, idx }))
				.filter(({ node, idx }) => node.order !== idx || node.parentId !== newParentId || node.id === draggedId);

			await Promise.all(
				updates.map(({ node, idx }) => {
					const body: Record<string, unknown> = { order: idx };
					if (node.id === draggedId && node.parentId !== newParentId) body.parentId = newParentId;
					return fetch(`/api/templates/${node.id}`, {
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					}).then(async (res) => {
						if (!res.ok) {
							const data = await res.json().catch(() => ({}));
							throw new Error(data.error ?? "Unable to move page.");
						}
					});
				}),
			);
			await onReload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to move page.");
		} finally {
			setBusy(false);
		}
	}

	function toggleCollapsed(id: string) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function renderNode(node: PageNode, depth: number): React.ReactNode {
		const children = childrenOf.get(node.id) ?? [];
		const isHome = node.parentId === null;
		const isCollapsed = collapsed.has(node.id);
		const isDropTarget = dropTarget?.id === node.id;
		const isCurrent = node.id === currentId;

		return (
			<div key={node.id}>
				<div
					draggable={!isHome && !busy}
					onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(node.id); }}
					onDragEnd={() => { setDragId(null); setDropTarget(null); }}
					onDragOver={(e) => {
						if (!dragId || dragId === node.id) return;
						e.preventDefault();
						const rect = e.currentTarget.getBoundingClientRect();
						const ratio = (e.clientY - rect.top) / rect.height;
						const zone: DropZone = isHome ? "inside" : ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
						setDropTarget({ id: node.id, zone });
					}}
					onDrop={(e) => {
						e.preventDefault();
						if (dragId && dropTarget?.id === node.id) void commitDrop(dragId, node.id, dropTarget.zone);
					}}
					style={{
						display: "flex", alignItems: "center", gap: "0.4rem",
						padding: "0.45rem 0.6rem",
						marginLeft: depth * 20,
						borderRadius: 8,
						background: isCurrent ? "var(--brand-subtle)" : isDropTarget && dropTarget?.zone === "inside" ? "rgba(129,140,248,0.15)" : "transparent",
						borderTop: isDropTarget && dropTarget?.zone === "before" ? "2px solid #818cf8" : "2px solid transparent",
						borderBottom: isDropTarget && dropTarget?.zone === "after" ? "2px solid #818cf8" : "2px solid transparent",
						cursor: isHome ? "default" : "grab",
						opacity: dragId === node.id ? 0.4 : 1,
					}}
				>
					{children.length > 0 ? (
						<button
							type="button"
							onClick={() => toggleCollapsed(node.id)}
							style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", cursor: "pointer", display: "flex", padding: 0 }}
						>
							<IconChevron open={!isCollapsed} />
						</button>
					) : (
						<span style={{ width: 11 }} />
					)}

					{renamingId === node.id ? (
						<div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: 1 }} onClick={(e) => e.stopPropagation()}>
							<input
								autoFocus
								value={renameName}
								onChange={(e) => setRenameName(e.target.value)}
								style={inputStyle}
							/>
							{!isHome && (
								<input
									value={renameSlug}
									onChange={(e) => setRenameSlug(e.target.value)}
									placeholder="url-segment"
									style={{ ...inputStyle, maxWidth: 130, color: "rgba(240,242,255,0.6)" }}
								/>
							)}
							<button type="button" onClick={() => void submitRename(node.id)} disabled={busy} style={smallBtnPrimary}>Save</button>
							<button type="button" onClick={() => setRenamingId(null)} style={smallBtn}>Cancel</button>
						</div>
					) : (
						<>
							<button
								type="button"
								onClick={() => onNavigate(node.id)}
								style={{
									flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer",
									fontFamily: "inherit", padding: "0.1rem 0",
								}}
							>
								<span style={{ fontSize: "0.85rem", fontWeight: isCurrent ? 700 : 500, color: "#f0f2ff", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
									{isHome && <IconHome />}{node.name}
									{node.sourceType === "RAW_UPLOAD" && (
										<span style={{
											marginLeft: "0.4rem", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.04em",
											textTransform: "uppercase", color: "#818cf8", background: "rgba(99,102,241,0.1)",
											padding: "0.1rem 0.4rem", borderRadius: 4, verticalAlign: "middle",
										}}>
											HTML
										</span>
									)}
								</span>
								<span style={{ display: "block", fontSize: "0.7rem", color: "rgba(240,242,255,0.35)" }}>
									{domainPreview ? `${domainPreview}${pathFor(node.id, byId)}` : pathFor(node.id, byId)}
								</span>
							</button>
							<div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
								{isUltra && (
									<button
										type="button"
										title="Add DnD sub-page"
										onClick={() => { setAddParentId(node.id); setNewPageName(""); }}
										style={iconBtn}
									>
										<IconPlus />
									</button>
								)}
								{isUltra && (
									<button
										type="button"
										title="Upload sub-page (.html/.zip)"
										onClick={() => triggerUpload(node.id)}
										style={iconBtn}
									>
										<IconUpload />
									</button>
								)}
								{node.sourceType === "BUILDER" ? (
									<button
										type="button"
										title="Switch to raw HTML editing"
										onClick={() => void switchToRaw(node.id)}
										style={iconBtn}
									>
										<IconSwitch />
									</button>
								) : (
									<button
										type="button"
										title="Switch to DnD builder (discards uploaded content)"
										onClick={() => setResetTarget(node)}
										style={iconBtn}
									>
										<IconSwitch />
									</button>
								)}
								{!isHome && isUltra && (
									<button type="button" title="Duplicate" onClick={() => void duplicatePage(node.id)} style={iconBtn}>
										<IconCopy />
									</button>
								)}
								<button
									type="button"
									title="Rename"
									onClick={() => { setRenamingId(node.id); setRenameName(node.name); setRenameSlug(node.slug ?? ""); }}
									style={iconBtn}
								>
									<IconEdit />
								</button>
								<button type="button" title="Delete" onClick={() => setDeleteTarget(node)} style={{ ...iconBtn, color: "#f87171" }}>
									<IconTrash />
								</button>
							</div>
						</>
					)}
				</div>

				{addParentId === node.id && (
					<div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginLeft: (depth + 1) * 20, padding: "0.4rem 0.6rem" }}>
						<input
							autoFocus
							placeholder="New page name (e.g. About Us)"
							value={newPageName}
							onChange={(e) => setNewPageName(e.target.value)}
							onKeyDown={(e) => { if (e.key === "Enter") void createPage(node.id); }}
							style={inputStyle}
						/>
						<button type="button" onClick={() => void createPage(node.id)} disabled={busy || !newPageName.trim()} style={smallBtnPrimary}>Add</button>
						<button type="button" onClick={() => setAddParentId(null)} style={smallBtn}>Cancel</button>
					</div>
				)}

				{!isCollapsed && children.map((child) => renderNode(child, depth + 1))}
			</div>
		);
	}

	const root = byId.get(rootId);
	const descendantCount = deleteTarget ? descendantIds(deleteTarget.id, childrenOf).size : 0;

	return (
		<div
			role="dialog"
			aria-modal="true"
			style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", padding: "1rem" }}
			onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div style={{ width: "min(100%,560px)", maxHeight: "80vh", display: "flex", flexDirection: "column", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, boxShadow: "0 30px 100px rgba(0,0,0,0.7)" }}>
				<input
					ref={uploadInputRef}
					type="file"
					accept=".html,.htm,.zip"
					onChange={(e) => void handleUploadFile(e)}
					style={{ display: "none" }}
				/>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.1rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
					<div>
						<p style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.2rem" }}>Site structure</p>
						<h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff" }}>Manage pages</h2>
					</div>
					<button type="button" onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, padding: "0.4rem", color: "rgba(240,242,255,0.5)", cursor: "pointer", display: "flex" }}>
						<IconX />
					</button>
				</div>

				<div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>
					{!isUltra && (
						<div style={{ margin: "0.25rem 0.25rem 0.75rem", padding: "0.75rem 0.9rem", borderRadius: 10, background: "var(--brand-subtle)", border: "1px solid rgba(139,92,246,0.25)", fontSize: "0.8rem", color: "rgba(240,242,255,0.8)", display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
							<IconSparkle /> <span>Multi-page sites (adding, duplicating pages) require an <strong>Ultra</strong> plan. Existing pages remain fully usable below.</span>
						</div>
					)}
					{root && renderNode(root, 0)}
				</div>

				{error && (
					<p style={{ padding: "0 1.25rem", fontSize: "0.78rem", color: "#f87171" }}>{error}</p>
				)}

				{isUltra && (
					<div style={{ padding: "0.6rem 1.25rem 1rem" }}>
						<button
							type="button"
							onClick={() => { setAddParentId(rootId); setNewPageName(""); }}
							style={{ ...smallBtn, width: "100%", justifyContent: "center", padding: "0.55rem", fontSize: "0.8rem" }}
						>
							<IconPlus /> Add top-level page
						</button>
					</div>
				)}
			</div>

			{deleteTarget && (
				<div
					style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", padding: "1rem" }}
					onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}
				>
					<div style={{ width: "min(100%,400px)", background: "#0d0f1a", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 16, padding: "1.5rem" }}>
						<h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.05rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.6rem" }}>
							{deleteTarget.parentId === null ? "Delete this site's home page?" : `Delete "${deleteTarget.name}"?`}
						</h3>
						<p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
							{deleteTarget.parentId === null
								? "This removes the whole site, including every page nested under it and its published domain link. This can't be undone."
								: descendantCount > 0
									? `This page has ${descendantCount} page${descendantCount === 1 ? "" : "s"} nested under it that will also be deleted. This can't be undone.`
									: "This can't be undone."}
						</p>
						<div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
							<button type="button" onClick={() => setDeleteTarget(null)} style={smallBtn}>Cancel</button>
							<button type="button" onClick={() => void confirmDelete()} disabled={busy} style={{ ...smallBtnPrimary, background: "#dc2626" }}>
								Delete{busy ? "…" : ""}
							</button>
						</div>
					</div>
				</div>
			)}

			{resetTarget && (
				<div
					style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", padding: "1rem" }}
					onClick={(e) => { if (e.target === e.currentTarget) setResetTarget(null); }}
				>
					<div style={{ width: "min(100%,400px)", background: "#0d0f1a", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 16, padding: "1.5rem" }}>
						<h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.05rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.6rem" }}>
							Switch &quot;{resetTarget.name}&quot; to the DnD builder?
						</h3>
						<p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
							There's no way to convert uploaded HTML into DnD blocks, so this discards the uploaded files
							entirely and starts the page from a blank canvas instead. This can't be undone.
						</p>
						<div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
							<button type="button" onClick={() => setResetTarget(null)} style={smallBtn}>Cancel</button>
							<button type="button" onClick={() => void confirmResetToBuilder()} disabled={busy} style={{ ...smallBtnPrimary, background: "#dc2626" }}>
								Switch{busy ? "…" : ""}
							</button>
						</div>
					</div>
				</div>
			)}

			{aupPending && (
				<div
					style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", padding: "1rem" }}
					onClick={(e) => { if (e.target === e.currentTarget) setAupPending(null); }}
				>
					<div style={{ width: "min(100%,440px)", background: "#0d0f1a", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 16, padding: "1.5rem" }}>
						<h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.05rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.6rem" }}>
							Accept the Acceptable Use Policy
						</h3>
						<p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
							Raw HTML uploads are published exactly as uploaded, with no content sanitization — you're
							responsible for what &quot;{aupPending.file.name}&quot; contains, including any script it runs.
							Required once per account, before your first raw upload.{" "}
							<a href="/legal/acceptable-use" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
								Read the policy
							</a>.
						</p>
						<div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
							<button type="button" onClick={() => setAupPending(null)} style={smallBtn}>Cancel</button>
							<button type="button" onClick={() => void confirmAupAndUpload()} disabled={busy} style={smallBtnPrimary}>
								{busy ? "Uploading…" : "Accept & Upload"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

const inputStyle: React.CSSProperties = {
	flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
	borderRadius: 7, color: "#f0f2ff", padding: "0.4rem 0.6rem", fontSize: "0.82rem", outline: "none", fontFamily: "inherit",
};

const smallBtn: React.CSSProperties = {
	display: "inline-flex", alignItems: "center", gap: "0.35rem",
	padding: "0.35rem 0.7rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)",
	background: "transparent", color: "rgba(240,242,255,0.7)", cursor: "pointer", fontFamily: "inherit",
	fontSize: "0.76rem", fontWeight: 600,
};

const smallBtnPrimary: React.CSSProperties = {
	...smallBtn, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
};

const iconBtn: React.CSSProperties = {
	display: "flex", alignItems: "center", justifyContent: "center",
	width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent",
	color: "rgba(240,242,255,0.45)", cursor: "pointer", fontSize: "0.8rem",
};
