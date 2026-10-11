"""
End-to-end checks in a real Chromium browser against a running stack:
  backend (npm start) on API_URL and the built frontend (npm run preview) on APP_URL.

Covers: student/staff/admin critical flows, the >5 distinct-reporter escalation through the UI,
manual-override protection, server-side permission checks, responsive layout (no horizontal
scrolling, working mobile menu), axe-core accessibility scan, and browser console errors.

Usage: python3 e2e/run_e2e.py   (see EXECUTION_GUIDE.md; the stack must already be running and seeded)
Writes screenshots and results to e2e/results/.
"""
import json, os, sys, time, uuid, pathlib, urllib.request, http.cookiejar
from playwright.sync_api import sync_playwright, expect

APP = os.environ.get("APP_URL", "http://localhost:4173")
STAFF_PASSWORD = os.environ["SEED_STAFF_PASSWORD"]
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@campus.example")
ADMIN_PASSWORD = os.environ["SEED_ADMIN_PASSWORD"]
OUT = pathlib.Path(__file__).parent / "results"
OUT.mkdir(exist_ok=True)
AXE = (pathlib.Path(__file__).parent / "node_modules/axe-core/axe.min.js").read_text()
RUN = uuid.uuid4().hex[:6]
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")

results, console_errors, a11y = [], [], {}

def check(name, cond, detail=""):
    results.append({"check": name, "pass": bool(cond), "detail": detail})
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

class Api:
    """Plain HTTP client (through the same /api proxy the browser uses) for bulk setup steps."""
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(APP + "/api" + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"})
        try:
            with self.op.open(req) as r:
                raw = r.read(); return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read(); return e.code, (json.loads(raw) if raw else None)
    def multipart(self, path, fields):
        boundary = "----e2e" + uuid.uuid4().hex
        parts = b"".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items())
        req = urllib.request.Request(APP + "/api" + path, data=parts + f"--{boundary}--\r\n".encode(), method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Requested-With": "XMLHttpRequest"})
        try:
            with self.op.open(req) as r: return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

def axe_scan(page, label):
    page.add_script_tag(content=AXE)
    res = page.evaluate("async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help}))")
    a11y[label] = res
    serious = [v for v in res if v["impact"] in ("serious", "critical")]
    check(f"a11y: no serious/critical axe violations on {label}", not serious, "; ".join(f'{v["id"]}({v["nodes"]})' for v in serious))

def no_hscroll(page, label):
    over = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    check(f"layout: no horizontal scroll on {label}", over <= 1, f"overflow {over}px")

def login(page, email, password):
    page.goto(APP + "/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Sign in").click()
    # Wait until the sign-in request has completed and the app has routed to a portal.
    page.wait_for_url(lambda u: "/login" not in u)
    page.wait_for_load_state("networkidle")

def main():
    # ---------- setup via API: reference ids and five other students reporting the same issue ----------
    admin_api = Api()
    s, _ = admin_api.call("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    check("setup: admin can sign in", s == 200)
    cats = {c["name"]: c["_id"] for c in admin_api.call("GET", "/categories")[1]["items"]}
    locs = {l["name"]: l["_id"] for l in admin_api.call("GET", "/locations")[1]["items"]}
    issue = {"categoryId": cats["Network"], "locationId": locs["Library"]}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        try:
            _flows(page, ctx, browser, admin_api, cats, locs, issue)
        except Exception:
            page.screenshot(path=OUT / "failure.png", full_page=True)
            print("Saved failure screenshot to e2e/results/failure.png at", page.url)
            raise

def _flows(page, ctx, browser, admin_api, cats, locs, issue):
    if True:

        # ---------- Student 1 registers and reports through the UI ----------
        s1_email = f"amy.{RUN}@uni.test"
        page.goto(APP + "/register")
        axe_scan(page, "register")
        page.get_by_role("button", name="Create account").click()
        check("student: registration shows inline validation", page.get_by_text("Enter your full name.").is_visible())
        page.get_by_label("Full name").fill("Amy Student")
        page.get_by_label("Email").fill(s1_email)
        page.get_by_label("Password", exact=True).fill("Campus2026x")
        page.get_by_label("Confirm password").fill("Campus2026x")
        page.get_by_role("button", name="Create account").click()
        expect(page.get_by_role("heading", name="Hello, Amy")).to_be_visible()
        check("student: registered and landed on student overview", True)
        check("student: empty state invites a first report", page.get_by_text("You haven’t reported anything yet").is_visible())
        page.screenshot(path=OUT / "student-overview-empty.png", full_page=True)

        page.get_by_role("link", name="Report a problem").first.click()
        expect(page.get_by_role("heading", name="Report a problem")).to_be_visible()
        page.get_by_role("button", name="Submit complaint").click()
        check("student: complaint form shows inline errors", page.get_by_text("Choose what kind of problem this is.").is_visible())
        page.get_by_label("Title").fill("Library Wi-Fi keeps dropping")
        page.get_by_label("Kind of problem").select_option(label="Network")
        page.get_by_label("Where").select_option(label="Library")
        page.get_by_label("What’s happening").fill("Wi-Fi on the library second floor disconnects every few minutes since Monday.")
        page.get_by_label("Photo (optional)").set_input_files({"name": "router.png", "mimeType": "image/png", "buffer": PNG})
        axe_scan(page, "new complaint form (filled)")
        page.get_by_role("button", name="Submit complaint").click()
        expect(page.get_by_role("heading", name="Library Wi-Fi keeps dropping")).to_be_visible()
        check("student: submission confirmation with next step", page.get_by_text("Your complaint was submitted.").is_visible())
        check("student: photo attached and rendered via authorised endpoint", page.get_by_role("img", name="Photo attached to the complaint: router.png").is_visible())
        complaint_url = page.url
        cid = complaint_url.rstrip("/").split("/")[-1]
        check("student: no escalation yet with one reporter", page.locator(".banner-escalated").count() == 0)

        # ---------- Four more distinct students (5 total): no escalation ----------
        others = []
        for i in range(2, 6):
            a = Api()
            a.call("POST", "/auth/register", {"name": f"Student {i}", "email": f"s{i}.{RUN}@uni.test", "password": "Campus2026x"})
            st, body = a.multipart("/complaints", {"title": f"Wi-Fi down in library ({i})", "description": "The library Wi-Fi has been dropping repeatedly today.", **issue})
            others.append(a)
        # Student 1 submits again: same person must not count twice.
        st, body = Api.multipart(_relogin(s1_email), "/complaints", {"title": "Library Wi-Fi still dropping", "description": "Still disconnecting every few minutes, second report.", **issue})
        check("escalation: repeat report by same student accepted", st == 201)
        check("escalation: 5 distinct reporters (one repeating) does NOT escalate", st == 201 and body["issue"]["escalated"] is False)
        page.reload()
        check("escalation: student page shows no escalation at 5 reporters", page.locator(".banner-escalated").count() == 0)

        # ---------- Sixth distinct student ----------
        sixth = Api()
        sixth.call("POST", "/auth/register", {"name": "Student 6", "email": f"s6.{RUN}@uni.test", "password": "Campus2026x"})
        st, body = sixth.multipart("/complaints", {"title": "No internet in the library", "description": "Cannot connect to the library Wi-Fi at all this afternoon.", **issue})
        check("escalation: 6th distinct reporter escalates (API)", st == 201 and body["issue"]["escalated"] is True and body["complaint"]["priority"] == "Critical")
        page.reload()
        expect(page.locator(".banner-escalated")).to_be_visible()
        check("escalation: student sees escalation banner after reload", page.get_by_text("Several students have reported this same problem").is_visible())
        check("escalation: student's complaint now Critical", page.locator(".badge.pr-Critical").first.is_visible())
        page.screenshot(path=OUT / "student-detail-escalated.png", full_page=True)
        page.goto(APP + "/student/complaints")
        expect(page.get_by_role("heading", name="My complaints")).to_be_visible()
        expect(page.locator(".ticket").first).to_be_visible()
        n_esc, n_all = page.locator(".ticket[data-escalated='true']").count(), page.locator(".ticket").count()
        check("escalation: list shows striped escalated rows for the student", n_esc == 2 and n_all == 2, f"{n_esc} escalated of {n_all}")
        axe_scan(page, "student complaint list")

        # ---------- Server-side permissions after integration ----------
        st, _ = others[0].call("GET", f"/complaints/{cid}")
        check("permissions: another student gets 404 for Amy's complaint", st == 404)
        for path in ["/users", "/issues", "/reports/summary", "/settings", "/staff"]:
            st, _ = others[0].call("GET", path)
            check(f"permissions: student forbidden from GET {path}", st == 403)
        st, _ = others[0].call("PATCH", f"/complaints/{cid}/priority", {"priority": "Low", "reason": "x y z"})
        check("permissions: student cannot override priority", st == 403)
        page.goto(APP + "/admin/users")
        expect(page.get_by_role("navigation", name="Student portal")).to_be_visible()
        check("permissions: student visiting /admin URL is redirected to student portal", "/student" in page.url)

        page.get_by_role("button", name="Sign out").click()
        expect(page.get_by_role("heading", name="Sign in")).to_be_visible()
        check("auth: sign out returns to sign-in", True)

        # ---------- Staff flow ----------
        login(page, "network.staff@campus.example", STAFF_PASSWORD)
        expect(page.get_by_role("heading", name="My queue")).to_be_visible()
        check("staff: auto-assigned complaints appear in queue", page.locator(".ticket").count() >= 1)
        axe_scan(page, "staff queue")
        page.goto(complaint_url.replace("/student/complaints/", "/staff/complaints/"))
        expect(page.get_by_role("heading", name="Library Wi-Fi keeps dropping")).to_be_visible()
        check("staff: sees reporter count on escalated issue", page.get_by_text("different people have reported this problem").is_visible())
        check("staff: AI summary present and honestly labelled (no provider configured)", page.get_by_text("Rule-based, not AI").first.is_visible())
        page.get_by_label("Internal note (staff and admins only)").check()
        page.get_by_label("Internal note", exact=True).fill(f"INTERNAL-ONLY-{RUN}: the floor 2 unit is overheating.")
        page.get_by_role("button", name="Add internal note").click()
        expect(page.get_by_text(f"INTERNAL-ONLY-{RUN}")).to_be_visible()
        page.get_by_label("Reply to the student").check()
        page.get_by_text("Draft a reply with the resolution assistant").click()
        page.get_by_label("What should the reply say?").fill("We are replacing the faulty access point.")
        page.get_by_role("button", name="Create draft").click()
        expect(page.get_by_text("Draft inserted below")).to_be_visible()
        check("staff: draft is inserted for review, labelled as non-AI template", page.locator(".banner-info .tag-fallback").is_visible())
        page.get_by_label("Message to the student").fill(f"Hello, we are replacing the faulty access point on floor 2. Ref {RUN}.")
        page.get_by_role("button", name="Send message").click()
        expect(page.get_by_text(f"Ref {RUN}.")).to_be_visible()
        page.get_by_role("button", name="Start work").click()
        page.get_by_role("dialog").get_by_role("button", name="Start work").click()
        expect(page.get_by_role("heading", name="Status: In Progress")).to_be_visible()
        # Resolution and Response Agent (no provider configured: labelled rule-based output)
        page.get_by_role("button", name="Suggest troubleshooting steps").click()
        expect(page.get_by_text("not an analysis of this complaint")).to_be_visible()
        check("staff: troubleshooting suggestions shown and labelled rule-based", page.locator("#res-h ~ .ai-box .tag-fallback").first.is_visible())
        page.get_by_role("button", name="Review before resolving").click()
        expect(page.get_by_text("More information needed")).to_be_visible()
        check("staff: evidence review with no note flags missing information", page.get_by_text("Missing:").first.is_visible())
        note = f"Replaced access point AP-{RUN} on floor 2 and stayed connected for 20 minutes from two rooms."
        page.get_by_label("What was done").fill(note)
        page.get_by_role("button", name="Review before resolving").click()
        expect(page.get_by_text("Cannot assess from the record")).to_be_visible()
        check("staff: evidence review is labelled not verified", page.get_by_text("Not verified.").is_visible())
        page.get_by_role("button", name="Mark resolved").click()
        dlg = page.get_by_role("dialog")
        check("staff: resolution note pre-filled from the review note", dlg.get_by_label("Resolution note").input_value() == note)
        dlg.get_by_role("button", name="Mark resolved").click()
        expect(page.get_by_role("heading", name="Status: Resolved")).to_be_visible()
        check("staff: moved complaint Assigned -> In Progress -> Resolved via UI (with resolution note)", True)
        axe_scan(page, "staff complaint detail")
        page.screenshot(path=OUT / "staff-detail.png", full_page=True)
        page.get_by_role("button", name="Sign out").click()

        # ---------- Student sees reply, not internal note; confirms fix ----------
        login(page, s1_email, "Campus2026x")
        page.goto(complaint_url)
        expect(page.get_by_text(f"Ref {RUN}.")).to_be_visible()
        check("student: sees staff public reply", True)
        check("student: does NOT see internal note", page.get_by_text(f"INTERNAL-ONLY-{RUN}").count() == 0)
        check("student: sees the resolution note", page.get_by_text(f"Reason: Replaced access point AP-{RUN}").is_visible())
        page.get_by_role("button", name="Confirm fixed and close").click()
        page.get_by_role("dialog").get_by_role("button", name="Confirm fixed and close").click()
        expect(page.get_by_role("heading", name="Status: Closed")).to_be_visible()
        check("student: confirmed fix and closed complaint", True)
        page.get_by_role("button", name="Sign out").click()

        # ---------- Admin flow: overview, issues, manual override protection ----------
        login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
        expect(page.get_by_role("heading", name="Overview")).to_be_visible()
        expect(page.locator(".figures")).to_be_visible()
        check("admin: overview figures render from live data", page.locator(".figure .n").first.inner_text().strip().isdigit())
        axe_scan(page, "admin overview")
        page.screenshot(path=OUT / "admin-overview.png", full_page=True)
        page.get_by_role("link", name="Repeated issues").click()
        expect(page.get_by_role("heading", name="Repeated issues")).to_be_visible()
        row = page.locator("tr", has_text="Network").filter(has_text="Library")
        expect(row).to_be_visible()
        check("admin: issue shows 6 distinct reporters and Escalated", row.get_by_text("6", exact=True).is_visible() and row.get_by_text("Escalated").is_visible())
        axe_scan(page, "admin repeated issues")

        # Override one open escalated complaint to High, then a 7th reporter arrives.
        st, lst = admin_api.call("GET", f"/complaints?categoryId={cats['Network']}&status=Assigned&limit=50")
        target = next(c for c in lst["items"] if c["priority"] == "Critical")
        page.goto(f"{APP}/admin/complaints/{target['_id']}")
        expect(page.get_by_role("heading", name="Administrator actions")).to_be_visible()
        page.get_by_label("Priority", exact=True).select_option("High")
        page.get_by_role("button", name="Override priority").click()
        dlg = page.get_by_role("dialog")
        dlg.get_by_role("button", name="Override priority").click()
        check("admin: override requires a reason", dlg.get_by_text("Enter a reason.").is_visible())
        dlg.get_by_label("Reason").fill("Duplicate of a fixed ticket")
        dlg.get_by_role("button", name="Override priority").click()
        expect(page.get_by_text("Set manually. Automatic escalation will not change it.")).to_be_visible()
        check("admin: manual override applied via UI", True)
        seventh = Api()
        seventh.call("POST", "/auth/register", {"name": "Student 7", "email": f"s7.{RUN}@uni.test", "password": "Campus2026x"})
        st, body = seventh.multipart("/complaints", {"title": "Library Wi-Fi outage", "description": "Library Wi-Fi is unusable again this evening.", **issue})
        check("escalation: 7th reporter's complaint is Critical", body["complaint"]["priority"] == "Critical")
        _, after = admin_api.call("GET", f"/complaints/{target['_id']}")
        check("escalation: manually overridden complaint stays High after re-escalation", after["complaint"]["priority"] == "High" and after["complaint"]["prioritySource"] == "override")

        for name, path in [("admin all complaints", "/admin/complaints"), ("admin staff coverage", "/admin/assign"), ("admin categories", "/admin/categories"),
                           ("admin users", "/admin/users"), ("admin reports", "/admin/reports"), ("admin settings", "/admin/settings")]:
            page.goto(APP + path)
            page.wait_for_load_state("networkidle")
            check(f"admin: {name} page loads without error state", page.locator(".banner-error[role=alert]").count() == 0)
            axe_scan(page, name)
        page.goto(APP + "/admin/settings")
        expect(page.get_by_text("Not configured.", exact=False)).to_be_visible()
        check("admin: settings states AI provider is not configured", True)

        # ---------- Responsive checks ----------
        pages_to_check = [("/admin", "admin overview"), ("/admin/complaints", "admin list"), (f"/admin/complaints/{cid}", "admin detail"),
                          ("/admin/issues", "issues"), ("/admin/users", "users"), ("/admin/reports", "reports")]
        for width, label in [(375, "mobile"), (768, "tablet"), (1280, "desktop")]:
            page.set_viewport_size({"width": width, "height": 860})
            for path, name in pages_to_check:
                page.goto(APP + path); page.wait_for_load_state("networkidle")
                no_hscroll(page, f"{name} @ {width}px")
            if width == 375:
                page.goto(APP + "/admin/complaints")
                menu = page.get_by_role("button", name="Open menu")
                check("mobile: sidebar hidden until menu opened", not page.locator("#sidebar").is_visible())
                menu.click()
                check("mobile: menu opens the navigation drawer", page.get_by_role("navigation", name="Admin portal").is_visible())
                page.keyboard.press("Escape")
                check("mobile: Escape closes the drawer", not page.locator("#sidebar").is_visible())
                menu.click()
                page.get_by_role("navigation", name="Admin portal").get_by_role("link", name="Reports").click()
                expect(page.get_by_role("heading", name="Reports")).to_be_visible()
                check("mobile: navigating closes the drawer", not page.locator("#sidebar").is_visible())
                for path, shot in [(f"/admin/complaints/{cid}", "mobile-admin-detail"), ("/admin", "mobile-admin-overview"), ("/admin/issues", "mobile-admin-issues")]:
                    page.goto(APP + path); page.wait_for_load_state("networkidle")
                    expect(page.locator(".skeleton")).to_have_count(0)
                    page.screenshot(path=OUT / f"{shot}.png", full_page=True)
        page.set_viewport_size({"width": 1280, "height": 900})

        # ---------- Keyboard: skip link ----------
        page.goto(APP + "/admin")
        expect(page.get_by_role("heading", name="Overview")).to_be_visible()
        page.keyboard.press("Tab")
        check("a11y: first Tab focuses the skip link", page.evaluate("() => document.activeElement.textContent") == "Skip to main content")

        # ---------- 404 and expired session ----------
        page.goto(APP + "/definitely/not/here")
        check("routing: unknown URL shows not-found page", page.get_by_role("heading", name="This page doesn’t exist").is_visible())
        ctx.clear_cookies()
        page.goto(APP + "/admin/users")
        expect(page.get_by_role("heading", name="Sign in")).to_be_visible()
        check("auth: missing session redirects to sign-in", True)
        browser.close()

    real_errors = [e for e in console_errors if "401" not in e and "Unauthorized" not in e and "404" not in e]
    check("browser: no console errors (excluding expected 401/404 responses)", not real_errors, " | ".join(real_errors[:5]))
    passed = sum(r["pass"] for r in results)
    (OUT / "results.json").write_text(json.dumps({"passed": passed, "total": len(results), "results": results, "axe": a11y, "consoleErrors": console_errors}, indent=2))
    print(f"\nE2E: {passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)

def _relogin(email):
    a = Api(); a.call("POST", "/auth/login", {"email": email, "password": "Campus2026x"}); return a

if __name__ == "__main__":
    main()
