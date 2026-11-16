"use client";

import { useState } from "react";
import { ArrowRight, Eye, ImagePlus, Pencil, Plus, Rocket, Store, Trash2 } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checklist,
  EmptyState,
  HelpMedia,
  HelpVideoLink,
  Input,
  Modal,
  ProgressBar,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonText,
  StatusPill,
  Stepper,
  Tabs,
  TaskCard,
  Textarea,
  Tooltip,
  useToast,
} from "@/app/dashboard/_v3/ui";
import { PlexoLogo } from "@/app/dashboard/_v3/brand/PlexoLogo";
import { useTour } from "@/app/dashboard/_v3/tour/TourProvider";

const TASKS = [
  { title: "Pick your design", desc: "Done. “Market”, in your colours." },
  { title: "Add your logo and colours", desc: "Done. Tomato red and your name." },
  { title: "Add your first product", desc: "Add a photo, a name and a price." },
  { title: "Choose how you get paid", desc: "Money goes straight to your bank account." },
  { title: "Choose your web address", desc: "Where customers will find you." },
  { title: "Put your site live", desc: "One tap. You can keep editing after." },
];

/** DEV ONLY: a Home-shaped page that uses every piece of the v3 kit, for screenshots and review. */
export function Gallery() {
  const toast = useToast();
  const tour = useTour();
  const [done, setDone] = useState(2);
  const [open, setOpen] = useState(2);
  const [modal, setModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [range, setRange] = useState<"week" | "month" | "year">("week");
  const [price, setPrice] = useState("");
  const [priceError, setPriceError] = useState<string | undefined>();

  const complete = () => {
    setDone((d) => Math.min(TASKS.length, d + 1));
    setOpen((o) => o + 1);
    toast.show({ title: "Saved", description: "It shows on your site straight away." });
  };

  return (
    <div className="plx-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="plx-eyebrow">Good afternoon, Ama</p>
          <h1 className="plx-h1">Let&apos;s get Ama&apos;s Kitchen selling</h1>
        </div>
        <Button variant="secondary" onClick={tour.openOffer}>
          Take the tour
        </Button>
      </div>

      <div className="plx-page__grid">
        <section data-tour="home-main" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Checklist done={done} total={TASKS.length}>
            {TASKS.map((t, i) => {
              const state = i < done ? "done" : i === done ? "current" : "upcoming";
              return (
                <TaskCard
                  key={t.title}
                  number={i + 1}
                  title={t.title}
                  description={i < done && i >= 2 ? "Done." : t.desc}
                  state={state}
                  expanded={open === i}
                  onToggle={() => setOpen(open === i ? -1 : i)}
                  aside={i < done ? <Button variant="secondary" size="sm" onClick={() => { setDone(i); setOpen(i); }}>Change</Button> : null}
                >
                  {i === 2 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                      <button type="button" className="plx-card plx-card--elevated" style={{ font: "inherit", width: 132, height: 132, border: "2px dashed var(--plx-border-strong)", color: "var(--plx-muted)", display: "grid", placeItems: "center", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                          <ImagePlus size={22} aria-hidden />
                          Add a photo
                        </span>
                      </button>
                      <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 14 }}>
                        <Input label="What are you selling?" defaultValue="Jollof rice tray" />
                        <Input
                          label="Price"
                          inputMode="decimal"
                          placeholder="e.g. 8,500"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          help="In naira. You can change it any time."
                          error={priceError}
                        />
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <Button
                            onClick={() => {
                              if (!price.trim()) return setPriceError("Please add a price, like 8,500.");
                              setPriceError(undefined);
                              complete();
                            }}
                          >
                            Add to my shop
                          </Button>
                          <span className="plx-small">It shows on your site straight away.</span>
                        </div>
                        <HelpMedia title="Adding your first product" caption="A 20-second look at adding a product." />
                      </div>
                    </div>
                  ) : i === 5 ? (
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <Button size="lg" leftIcon={<Rocket size={18} aria-hidden />} onClick={complete}>
                        Put my site live
                      </Button>
                      <span className="plx-small">You can keep editing after it&apos;s live.</span>
                    </div>
                  ) : i >= done ? (
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <Button onClick={complete}>Do this now</Button>
                      <HelpVideoLink title={t.title} label="Watch how" />
                    </div>
                  ) : null}
                </TaskCard>
              );
            })}
          </Checklist>
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding="none" style={{ overflow: "hidden" }}>
            <div style={{ height: 190, padding: 18, display: "flex", flexDirection: "column", gap: 10, background: "var(--plx-tint)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name="Ama's Kitchen" size={26} square />
                <span style={{ fontWeight: 800, fontSize: 14 }}>Ama&apos;s Kitchen</span>
                <span style={{ marginLeft: "auto" }}>
                  <StatusPill status="live" />
                </span>
              </div>
              <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.01em" }}>Homemade meals in Lagos, delivered</span>
              <span className="plx-btn plx-btn--strong plx-btn--sm" style={{ alignSelf: "flex-start", pointerEvents: "none" }}>
                Order now
              </span>
            </div>
            <div style={{ padding: 16, display: "flex", gap: 10 }}>
              <ButtonLink href="#" variant="strong" fullWidth leftIcon={<Pencil size={16} aria-hidden />}>
                Edit site
              </ButtonLink>
              <ButtonLink href="#" variant="secondary" fullWidth leftIcon={<Eye size={16} aria-hidden />}>
                Preview
              </ButtonLink>
            </div>
          </Card>
          <Card>
            <CardHeader title="Visits" description="People who opened your site." action={<SegmentedControl label="Period" value={range} onChange={setRange} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }]} />} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>1,284</span>
              <Badge tone="success">+18%</Badge>
            </div>
          </Card>
          <Button variant="secondary" leftIcon={<Plus size={18} aria-hidden />}>
            Create another website
          </Button>
        </aside>
      </div>

      <h2 className="plx-h2" style={{ marginTop: 24 }}>
        Kit
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))", gap: 20, alignItems: "start" }}>
        <Card>
          <CardHeader title="Buttons" description="One obvious main action per screen." titleAs="h3" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Button>Save</Button>
            <Button variant="secondary">Preview</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="strong">Edit site</Button>
            <Button variant="danger" leftIcon={<Trash2 size={16} aria-hidden />}>
              Delete
            </Button>
            <Button loading>Saving</Button>
            <Button size="sm" variant="secondary">
              Small
            </Button>
            <Button size="lg" rightIcon={<ArrowRight size={18} aria-hidden />}>
              Start setting up
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Fields" description="Labels, help and errors in plain words." titleAs="h3" />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="Your business name" placeholder="e.g. Ama's Kitchen" help="This shows at the top of your site." />
            <Select
              label="What do you sell?"
              defaultValue=""
              placeholder="Choose one"
              options={[
                { value: "food", label: "Food and drinks" },
                { value: "fashion", label: "Clothes and fashion" },
                { value: "beauty", label: "Beauty" },
              ]}
            />
            <Textarea label="What do you do, in one sentence?" optional rows={3} />
            <Input label="Your email" defaultValue="ama@" error="That email is missing the part after @, like ama@gmail.com." />
          </div>
        </Card>

        <Card>
          <CardHeader title="Status, people and hints" titleAs="h3" />
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <StatusPill status="live" />
              <StatusPill status="draft" />
              <StatusPill status="paused" />
              <StatusPill status="attention" />
              <Badge tone="brand">New</Badge>
              <Badge tone="info">Course</Badge>
              <Badge tone="warning">2 orders waiting</Badge>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Avatar name="Ama Owusu" />
              <Avatar name="Kofi Mensah" />
              <Avatar name="Zainab Bello" />
              <Avatar name="Tunde" />
              <span style={{ marginLeft: 8 }}>
                <Tooltip content="People who can edit this site">
                  <Button variant="secondary" size="sm">
                    Who&apos;s this?
                  </Button>
                </Tooltip>
              </span>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <PlexoLogo height={24} />
              <PlexoLogo markOnly height={28} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Progress" titleAs="h3" />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Stepper total={5} current={1} />
            <ProgressBar value={3} max={6} label="3 of 6 done" />
            <Tabs
              label="Site sections"
              items={[
                { id: "pages", label: "Pages", content: <p className="plx-body">Home, Shop, About and Contact.</p> },
                { id: "products", label: "Products", content: <p className="plx-body">4 products for sale.</p> },
                { id: "orders", label: "Orders", content: <p className="plx-body">2 new orders today.</p> },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Dialogs and messages" titleAs="h3" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Button variant="secondary" onClick={() => setModal(true)}>
              Open a dialog
            </Button>
            <Button variant="secondary" onClick={() => toast.show({ title: "Your site is live", description: "amaskitchen.plexopages.com", action: { label: "Copy link", onClick: () => {} } })}>
              Show a message
            </Button>
            <Button variant="secondary" onClick={() => toast.show({ tone: "danger", title: "We couldn't save that", description: "Check your internet connection and try again." })}>
              Show a problem
            </Button>
          </div>
        </Card>

        <Card aria-busy="true">
          <CardHeader title="Loading" titleAs="h3" />
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
            <Skeleton width={44} height={44} radius={999} />
            <div style={{ flex: 1 }}>
              <SkeletonText lines={2} />
            </div>
          </div>
          <Skeleton height={96} radius={14} />
        </Card>
      </div>

      <EmptyState
        title="No products yet"
        body="Add the first thing you sell. It takes a minute, and it shows on your site straight away."
        action={<Button leftIcon={<Store size={18} aria-hidden />}>Add a product</Button>}
      />

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Delete “Kitchen notes”?"
        description="The blog and its 3 posts will be gone for good. Your other sites aren't affected."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={() => {
                setDeleting(true);
                window.setTimeout(() => {
                  setDeleting(false);
                  setModal(false);
                  toast.show({ title: "Deleted", description: "“Kitchen notes” is gone." });
                }, 900);
              }}
            >
              Delete blog
            </Button>
          </>
        }
      >
        <Input label="Type DELETE to confirm" placeholder="DELETE" />
      </Modal>
    </div>
  );
}
