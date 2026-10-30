from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path('/Users/al-ameen/Documents/EveryTicket')
OUT_DIR = ROOT / 'docs'
OUTPUT = OUT_DIR / 'EverythingTicket_NestJS_Backend_Implementation_Guide.docx'

BLACK = '000000'
PLUM = '3D0A4F'
PURPLE = '6B128C'
ORANGE = 'F39A13'
PALE = 'F7F2F8'
PALE_ALT = 'FBF8FC'
GRAY = '5F5964'
LIGHT_GRAY = 'D9D9D9'
WHITE = 'FFFFFF'


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd')
        tc_pr.append(shd)
    shd.set(qn('w:fill'), fill)


def set_cell_border(cell, color: str = LIGHT_GRAY, size: int = 6) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in('w:tcBorders')
    if borders is None:
        borders = OxmlElement('w:tcBorders')
        tc_pr.append(borders)
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        tag = f'w:{edge}'
        el = borders.find(qn(tag))
        if el is None:
            el = OxmlElement(tag)
            borders.append(el)
        el.set(qn('w:val'), 'single')
        el.set(qn('w:sz'), str(size))
        el.set(qn('w:color'), color)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in('w:tcMar')
    if tc_mar is None:
        tc_mar = OxmlElement('w:tcMar')
        tc_pr.append(tc_mar)
    for margin, value in (('top', top), ('start', start), ('bottom', bottom), ('end', end)):
        node = tc_mar.find(qn(f'w:{margin}'))
        if node is None:
            node = OxmlElement(f'w:{margin}')
            tc_mar.append(node)
        node.set(qn('w:w'), str(value))
        node.set(qn('w:type'), 'dxa')


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement('w:tblHeader')
    tbl_header.set(qn('w:val'), 'true')
    tr_pr.append(tbl_header)


def keep_with_next(paragraph) -> None:
    paragraph.paragraph_format.keep_with_next = True


def remove_paragraph_borders(paragraph) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = p_pr.find(qn('w:pBdr'))
    if p_bdr is not None:
        p_pr.remove(p_bdr)


def prevent_row_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement('w:cantSplit')
    tr_pr.append(cant_split)


def set_run_font(run, name: str = 'Arial', size: float | None = None, color: str | None = None, bold: bool | None = None) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:ascii'), name)
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:hAnsi'), name)
    if size is not None:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold


def add_page_number(paragraph) -> None:
    paragraph.add_run('Page ')
    run = paragraph.add_run()
    fld_char_1 = OxmlElement('w:fldChar')
    fld_char_1.set(qn('w:fldCharType'), 'begin')
    instr_text = OxmlElement('w:instrText')
    instr_text.set(qn('xml:space'), 'preserve')
    instr_text.text = 'PAGE'
    fld_char_2 = OxmlElement('w:fldChar')
    fld_char_2.set(qn('w:fldCharType'), 'end')
    run._r.append(fld_char_1)
    run._r.append(instr_text)
    run._r.append(fld_char_2)


def hyperlink(paragraph, text: str, url: str):
    part = paragraph.part
    relationship_id = part.relate_to(
        url,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        is_external=True,
    )
    link = OxmlElement('w:hyperlink')
    link.set(qn('r:id'), relationship_id)
    run = OxmlElement('w:r')
    r_pr = OxmlElement('w:rPr')
    color = OxmlElement('w:color')
    color.set(qn('w:val'), PURPLE)
    underline = OxmlElement('w:u')
    underline.set(qn('w:val'), 'single')
    r_pr.append(color)
    r_pr.append(underline)
    run.append(r_pr)
    text_node = OxmlElement('w:t')
    text_node.text = text
    run.append(text_node)
    link.append(run)
    paragraph._p.append(link)


def add_body(doc: Document, text: str, *, bold_lead: str | None = None, keep=False):
    p = doc.add_paragraph()
    if bold_lead and text.startswith(bold_lead):
        lead = p.add_run(bold_lead)
        lead.bold = True
        p.add_run(text[len(bold_lead):])
    else:
        p.add_run(text)
    if keep:
        keep_with_next(p)
    return p


def add_bullets(doc: Document, items: Iterable[str], level: int = 0) -> None:
    style = 'List Bullet' if level == 0 else 'List Bullet 2'
    for item in items:
        doc.add_paragraph(item, style=style)


def add_numbered(doc: Document, items: Iterable[str]) -> None:
    for index, item in enumerate(items, start=1):
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Inches(0.28)
        paragraph.paragraph_format.first_line_indent = Inches(-0.28)
        paragraph.paragraph_format.space_after = Pt(3)
        paragraph.paragraph_format.line_spacing = 1.05
        marker = paragraph.add_run(f'{index}.  ')
        set_run_font(marker, size=10.2)
        content = paragraph.add_run(item)
        set_run_font(content, size=10.2)


def add_code(doc: Document, code: str, caption: str | None = None) -> None:
    if caption:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(5)
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(caption)
        set_run_font(r, size=9, color=GRAY, bold=True)
        keep_with_next(p)
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.22)
    p.paragraph_format.right_indent = Inches(0.1)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.0
    p.paragraph_format.keep_together = True
    p_pr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:fill'), 'F3F0F4')
    p_pr.append(shd)
    tabs = p_pr.find(qn('w:tabs'))
    if tabs is None:
        tabs = OxmlElement('w:tabs')
        p_pr.append(tabs)
    run = p.add_run(code)
    set_run_font(run, name='Courier New', size=8.25, color='25142C')


def add_table(doc: Document, headers: Sequence[str], rows: Sequence[Sequence[str]], widths: Sequence[float] | None = None, font_size: float = 8.7):
    table = doc.add_table(rows=1, cols=len(headers))
    table.autofit = False
    table.alignment = 1
    table.rows[0]._tr.get_or_add_trPr()
    set_repeat_table_header(table.rows[0])
    for idx, header in enumerate(headers):
        cell = table.rows[0].cells[idx]
        set_cell_shading(cell, PLUM)
        set_cell_border(cell)
        set_cell_margins(cell, 105, 115, 105, 115)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        if widths:
            cell.width = Inches(widths[idx])
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(header)
        set_run_font(r, size=font_size, color=WHITE, bold=True)
    for row_idx, row_values in enumerate(rows):
        row = table.add_row()
        prevent_row_split(row)
        for col_idx, value in enumerate(row_values):
            cell = row.cells[col_idx]
            set_cell_border(cell)
            set_cell_margins(cell)
            set_cell_shading(cell, WHITE if row_idx % 2 == 0 else PALE_ALT)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if widths:
                cell.width = Inches(widths[col_idx])
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.03
            r = p.add_run(str(value))
            set_run_font(r, size=font_size, color=BLACK)
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(2)
    return table


def add_section_title(doc: Document, title: str, level: int = 1) -> None:
    p = doc.add_heading(title, level=level)
    keep_with_next(p)


def configure_document(doc: Document) -> None:
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.7)
    section.bottom_margin = Inches(0.68)
    section.left_margin = Inches(0.78)
    section.right_margin = Inches(0.78)

    styles = doc.styles
    normal = styles['Normal']
    normal.font.name = 'Arial'
    normal._element.rPr.rFonts.set(qn('w:ascii'), 'Arial')
    normal._element.rPr.rFonts.set(qn('w:hAnsi'), 'Arial')
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(BLACK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.08

    title = styles['Title']
    title.font.name = 'Arial'
    title._element.rPr.rFonts.set(qn('w:ascii'), 'Arial')
    title._element.rPr.rFonts.set(qn('w:hAnsi'), 'Arial')
    title.font.size = Pt(31)
    title.font.bold = True
    title.font.color.rgb = RGBColor.from_string(BLACK)
    title.paragraph_format.space_after = Pt(14)
    title_ppr = title._element.get_or_add_pPr()
    title_border = title_ppr.find(qn('w:pBdr'))
    if title_border is not None:
        title_ppr.remove(title_border)

    for name, size, before, after in (
        ('Heading 1', 18, 16, 8),
        ('Heading 2', 13.5, 12, 5),
        ('Heading 3', 11.2, 9, 4),
    ):
        style = styles[name]
        style.font.name = 'Arial'
        style._element.rPr.rFonts.set(qn('w:ascii'), 'Arial')
        style._element.rPr.rFonts.set(qn('w:hAnsi'), 'Arial')
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(BLACK)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    for name in ('List Bullet', 'List Bullet 2', 'List Number'):
        style = styles[name]
        style.font.name = 'Arial'
        style._element.rPr.rFonts.set(qn('w:ascii'), 'Arial')
        style._element.rPr.rFonts.set(qn('w:hAnsi'), 'Arial')
        style.font.size = Pt(10.2)
        style.paragraph_format.space_after = Pt(3)
        style.paragraph_format.line_spacing = 1.05

    header = section.header
    hp = header.paragraphs[0]
    hp.text = 'EVERYTICKET  |  BACKEND IMPLEMENTATION GUIDE'
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_run_font(hp.runs[0], size=7.5, color=GRAY, bold=True)
    footer = section.footer
    table = footer.add_table(rows=1, cols=2, width=Inches(6.9))
    table.columns[0].width = Inches(5.2)
    table.columns[1].width = Inches(1.7)
    p0 = table.cell(0, 0).paragraphs[0]
    p0.add_run('Implementation baseline  |  19 October 2026')
    set_run_font(p0.runs[0], size=7.5, color=GRAY)
    p1 = table.cell(0, 1).paragraphs[0]
    p1.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    add_page_number(p1)
    for run in p1.runs:
        set_run_font(run, size=7.5, color=GRAY)


def build_document() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = Document()
    configure_document(doc)

    # Cover
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(38)
    label = doc.add_paragraph()
    label.paragraph_format.space_after = Pt(10)
    r = label.add_run('TECHNICAL IMPLEMENTATION GUIDE')
    set_run_font(r, size=10, color=PURPLE, bold=True)
    r.font.letter_spacing = Pt(1.2)
    title = doc.add_paragraph(style='Title')
    title.add_run('EverythingTicket NestJS Backend Implementation')
    remove_paragraph_borders(title)
    subtitle = doc.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(22)
    run = subtitle.add_run('Architecture, modules, data integrity, APIs, background work, deployment and verification')
    set_run_font(run, size=15, color=GRAY)
    meta = add_table(doc, ['Document field', 'Value'], [
        ['Prepared for', 'EverythingTicket product and engineering team'],
        ['Implementation baseline', '19 October 2026'],
        ['Primary runtime', 'NestJS and TypeScript'],
        ['Data and state', 'PostgreSQL with Prisma ORM'],
        ['Authentication', 'Better Auth with the official Prisma adapter'],
        ['Payments', 'Paystack verification and webhook reconciliation'],
        ['Background processing', 'BullMQ with external managed Redis'],
        ['Object storage', 'Cloudflare R2'],
        ['Deployment model', 'VPS system services without Docker'],
    ], widths=[1.75, 4.85], font_size=9.2)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    r = p.add_run('Source basis')
    set_run_font(r, size=9, color=PURPLE, bold=True)
    p2 = doc.add_paragraph('EverythingTicket Backend Development Specification version 1.1 dated 6 October 2026. This guide converts that product specification into an implementation plan; it does not expand the contracted feature scope.')
    p2.paragraph_format.space_after = Pt(0)
    doc.add_page_break()

    # Executive direction and contents
    add_section_title(doc, 'Implementation direction')
    add_body(doc, 'Build one modular NestJS codebase with two executable entry points: an HTTP API and a background worker. PostgreSQL remains authoritative for commercial and admission state. Redis supports queues, rate limiting and short-lived cache, but it never becomes the only copy of an order, inventory hold, payment result, ticket, refund, payout or check-in. Every operation that changes money, inventory or admission must complete inside a reviewed PostgreSQL transaction and remain safe when a request, webhook or job is replayed.')
    add_body(doc, 'The first production milestone is not the dashboard. It is the integrity layer: authentication and ownership, versioned fee calculation, concurrent inventory holds, Paystack verification, idempotent ticket issuance and atomic check-in. Organizer, admin and reporting features should build on those invariants instead of maintaining parallel versions of the same business rules.')
    add_section_title(doc, 'How to use this guide', 2)
    add_bullets(doc, [
        'Backend engineers use Sections 2 through 12 to structure the repository and implement the domain services.',
        'Reviewers use the invariants, transaction boundaries and acceptance matrix to reject unsafe shortcuts.',
        'DevOps uses Sections 14 through 16 to provision managed services, configure systemd, deploy and monitor the API and worker.',
        'Product owners resolve the decisions in Section 18 before production data or live Paystack credentials are introduced.',
    ])
    add_section_title(doc, 'Contents', 2)
    add_table(doc, ['Section', 'Purpose', 'Section', 'Purpose'], [
        ['1', 'Product boundary and architectural decisions', '10', 'Refunds, payouts and accounting records'],
        ['2', 'System architecture and trust boundaries', '11', 'REST API conventions and endpoint map'],
        ['3', 'Repository layout and runtime entry points', '12', 'Jobs, outbox delivery and scheduled work'],
        ['4', 'NestJS modules and ownership', '13', 'Security and privacy controls'],
        ['5', 'Bootstrap, authentication and request pipeline', '14', 'Testing and acceptance evidence'],
        ['6', 'Prisma data model and database constraints', '15', 'Infrastructure and deployment'],
        ['7', 'Inventory, checkout and fee calculation', '16', 'Monitoring and operational runbooks'],
        ['8', 'Paystack payment finalization and recovery', '17', 'Delivery plan and completion criteria'],
        ['9', 'Tickets, RSVP and admission', '18', 'Production decisions and implementation references'],
    ], widths=[0.5, 2.8, 0.5, 2.8], font_size=7.9)

    doc.add_page_break()
    add_section_title(doc, '1 Product boundary and architectural decisions')
    add_body(doc, 'The backend supports the three product surfaces already defined for EverythingTicket: the customer site, organizer workspace and administrator portal. The same API enforces role and ownership boundaries for all three surfaces. Organizers publish valid events directly; administrators supervise platform access, risk, refunds, payouts and fee rules but do not approve ordinary event publication.')
    add_section_title(doc, '1.1 Fixed technology choices', 2)
    add_table(doc, ['Concern', 'Implementation choice', 'Reason'], [
        ['Application framework', 'NestJS with TypeScript and the Express adapter', 'The selected Better Auth integration and Paystack raw-body route are simplest to validate on Express.'],
        ['API style', 'REST under /api/v1 with generated OpenAPI', 'Matches the reference surface and keeps clients independent of persistence models.'],
        ['Database', 'Managed PostgreSQL', 'Authoritative source for orders, holds, payments, credentials, refunds, payouts and check-ins.'],
        ['ORM', 'Prisma Client and Prisma Migrate', 'One reviewed schema for Better Auth and EverythingTicket business models.'],
        ['Authentication', 'Better Auth with Prisma adapter', 'Owns user, session, account and verification records without duplicate password storage.'],
        ['Queues and cache', 'BullMQ on managed Redis', 'Runs retryable work outside the request path while PostgreSQL outbox rows protect durable intent.'],
        ['Payments', 'Paystack direct collection to the platform account', 'No split settlement, subaccount instruction or automatic organizer transfer in the MVP.'],
        ['Object storage', 'Cloudflare R2 through its S3-compatible API', 'Public event media and private ticket PDFs use separate access patterns.'],
        ['Compute', 'API and worker as separate systemd services on one VPS', 'The source explicitly excludes Docker and requires restartable processes.'],
    ], widths=[1.25, 2.15, 3.2])
    add_section_title(doc, '1.2 Invariants that every module must preserve', 2)
    add_bullets(doc, [
        'All money is integer kobo in NGN. Floating-point arithmetic is prohibited in domain calculations.',
        'The server calculates prices, fees, eligibility and totals. Client totals are display data only and are never trusted.',
        'An order stores immutable ticket-price and fee-rule snapshots. Later event or fee changes do not rewrite history.',
        'Only verified payment evidence can mark an order paid. Browser callbacks may request reconciliation but cannot fulfill value.',
        'Payment finalization is idempotent. Replays cannot issue duplicate tickets, decrement inventory twice or duplicate email intent.',
        'Each ticket or guest credential can create at most one check-in record. Concurrent devices produce one success.',
        'Organizer queries include organizer ownership in the database predicate. Controller guards alone are insufficient.',
        'Redis accelerates work but cannot be the source of truth for money, inventory, credentials or entry.',
        'Deleting or hiding an event never removes financial, ticket, refund, payout, check-in or audit history.',
    ])
    add_section_title(doc, '1.3 Explicit exclusions', 2)
    add_body(doc, 'Do not implement native apps, offline multi-device scanning, seating maps, dynamic pricing, ticket resale, automatic bank transfers, Paystack split settlement, campaign messaging, SMS or WhatsApp, a CMS, staff account delegation, or administrator-created events unless a written change request adds them. The implementation may leave extension points, but it must not expose unfinished routes or schema fields as supported features.')

    doc.add_page_break()
    add_section_title(doc, '2 System architecture and trust boundaries')
    add_section_title(doc, '2.1 Runtime view', 2)
    add_table(doc, ['Caller or service', 'Boundary', 'Primary responsibility', 'Trust rule'], [
        ['Customer, organizer and admin web clients', 'HTTPS through Cloudflare', 'Render product flows and call the API', 'All client input is untrusted, including totals, ownership IDs and status values.'],
        ['NestJS API process', 'Public application boundary', 'Authentication, validation, authorization, transactions and response contracts', 'Only this process may authorize protected writes.'],
        ['NestJS worker process', 'Private application boundary', 'Email, PDFs, scheduled reconciliation, hold cleanup and media cleanup', 'Jobs carry IDs, not secrets or full business objects; handlers reload current PostgreSQL state.'],
        ['Managed PostgreSQL', 'Authoritative state boundary', 'Business state, constraints, outbox intent and audit history', 'Transactions and unique constraints resolve races.'],
        ['Managed Redis', 'Ephemeral coordination boundary', 'BullMQ, rate limits, session secondary storage and cache', 'Loss or flush may delay work but must not erase business truth.'],
        ['Paystack', 'External payment boundary', 'Payment initialization, verification and refund evidence', 'Verify signature and transaction server-to-server before fulfillment.'],
        ['Cloudflare R2', 'External object boundary', 'Event images and private ticket PDFs', 'Database stores keys; private objects require short-lived signed access.'],
        ['Email provider', 'External delivery boundary', 'Transactional delivery', 'Delivery failure never rolls back paid or accepted business state.'],
    ], widths=[1.25, 1.25, 2.05, 2.05])
    add_section_title(doc, '2.2 Request and event flow', 2)
    add_numbered(doc, [
        'Cloudflare terminates HTTPS and forwards a request with an application request ID or a trusted proxy chain.',
        'NestJS applies request ID, structured logging, body limits, validation, authentication, role checks, ownership checks and rate limits as appropriate to the route.',
        'The domain service performs one coherent PostgreSQL transaction for any money, inventory, admission or audit mutation.',
        'The transaction writes durable notification or job intent to an outbox table when asynchronous work is required.',
        'An outbox dispatcher publishes a compact BullMQ job with a deterministic job ID. The worker reloads source data from PostgreSQL and performs the side effect.',
        'Monitoring correlates API logs, worker logs, Paystack references and internal IDs without exposing sensitive tokens or unnecessary personal information.',
    ])
    add_section_title(doc, '2.3 Dependency direction', 2)
    add_body(doc, 'Controllers depend on application services. Application services depend on domain policies and repository interfaces. Infrastructure adapters implement Prisma, Paystack, R2, Redis and email access. Domain policies must not import controllers or vendor SDKs. This rule keeps fee calculation, payout eligibility, credential status and state transitions testable without an HTTP server.')
    add_code(doc, 'HTTP controller\n  -> application service\n      -> domain policy / state machine\n      -> repository port\n          -> Prisma transaction adapter\n      -> external provider port\n          -> Paystack / R2 / email adapter', 'Required dependency direction')

    add_section_title(doc, '3 Repository layout and runtime entry points')
    add_body(doc, 'Use one repository and one dependency graph. Build two executables so API restarts and worker failures can be managed independently. A monorepo tool is optional; the following structure works with the standard Nest CLI and keeps shared code in ordinary modules.')
    add_code(doc, '''src/
  main.ts                         API bootstrap
  worker.ts                       worker bootstrap
  app.module.ts                   API composition root
  worker.module.ts                worker composition root
  config/                         typed configuration and validation
  common/
    auth/ guards/ decorators/ errors/ logging/ pagination/
  infrastructure/
    prisma/ redis/ paystack/ r2/ email/ queues/
  modules/
    account/ catalog/ events/ fees/ checkout/ payments/
    tickets/ rsvp/ check-in/ refunds/ payouts/ media/
    notifications/ admin/ audit/ health/
prisma/
  schema.prisma
  migrations/
  seed.ts
test/
  factories/ fixtures/ integration/ concurrency/ e2e/
deploy/
  systemd/ nginx/ scripts/ runbooks/
docs/
  openapi/ adr/''')
    add_section_title(doc, '3.1 Composition roots', 2)
    add_table(doc, ['Entry point', 'Includes', 'Excludes'], [
        ['main.ts', 'HTTP controllers, Better Auth bridge, guards, validation, OpenAPI, health, queue producers', 'BullMQ processors and scheduled work'],
        ['worker.ts', 'Queue processors, outbox dispatcher, schedulers, provider adapters, worker health reporting', 'Public HTTP controllers except a local-only health listener if required'],
        ['prisma/seed.ts', 'Development admin, roles, categories, fee rule and sample events', 'Live credentials, production customers or reusable passwords'],
    ], widths=[1.1, 2.9, 2.6])
    add_section_title(doc, '3.2 Package policy', 2)
    add_body(doc, 'Pin compatible major versions in the lockfile and review release notes before upgrades. Do not copy integration examples blindly across Prisma or NestJS major versions. The Better Auth NestJS adapter is community maintained, so its compatibility test belongs in continuous integration and staging. Use the official Prisma adapter for Better Auth and regenerate the Prisma client after every reviewed schema change.')

    add_section_title(doc, '4 NestJS modules and ownership')
    add_table(doc, ['Module', 'Owns', 'Depends on'], [
        ['AccountModule', 'Application profile, roles, status and self-service account views', 'Better Auth session, Prisma, Audit'],
        ['CatalogModule', 'Public categories, published event search, filters and availability projection', 'Events, Checkout read model, Cache'],
        ['EventsModule', 'Organizer event and ticket-type lifecycle', 'Account status, Media, Audit'],
        ['FeesModule', 'Immutable fee-rule versions and fee calculation', 'Prisma, Audit'],
        ['CheckoutModule', 'Quotes, orders, lines, holds and free-order confirmation', 'Events, Fees, Payments, Tickets, Notifications'],
        ['PaymentsModule', 'Paystack initialization, verification, webhooks, attempts and reconciliation', 'Checkout, Tickets, Notifications, Audit'],
        ['TicketsModule', 'Ticket issuance, QR secret digests, PDF intent and secure account access', 'R2, Notifications'],
        ['RsvpModule', 'Guest lists, invitation links, responses, guest credentials and export', 'Events, Notifications, CheckIn'],
        ['CheckInModule', 'Credential preview, atomic confirmation and summaries', 'Tickets, RSVP, Events'],
        ['RefundsModule', 'Organizer requests, admin decisions, gateway status and ticket revocation', 'Payments, Tickets, Audit, Notifications'],
        ['PayoutsModule', 'Eligibility, request ledger, admin decision and manual transfer record', 'Events, Refunds, Audit, Notifications'],
        ['MediaModule', 'Upload intent, ownership verification, R2 keys and orphan cleanup', 'Events, R2, Jobs'],
        ['NotificationsModule', 'Outbox intent, rendering, delivery attempts and resend', 'Email, Queues'],
        ['AdminModule', 'Cross-platform search, suspension, blocking, feature selection and summaries', 'Account, Events, Fees, Refunds, Payouts, Audit'],
        ['AuditModule', 'Append-only administrative and financial mutation history', 'Prisma'],
        ['HealthModule', 'Liveness, readiness and dependency checks', 'Prisma, Redis, configuration'],
    ], widths=[1.35, 3.25, 2.0], font_size=8.2)
    add_section_title(doc, '4.1 Service boundaries', 2)
    add_body(doc, 'A module may read another module through an exported query service or a purpose-built repository port. It must not update another module’s tables directly. The only intentional cross-module transaction coordinators are checkout creation, payment finalization, refund completion, payout approval and account blocking. Each coordinator receives the Prisma transaction client and passes it to every participating helper.')
    add_section_title(doc, '4.2 State transition policy', 2)
    add_table(doc, ['Aggregate', 'Allowed transitions', 'Rejected transitions'], [
        ['Event', 'DRAFT to PUBLISHED; PUBLISHED to SUSPENDED or CANCELLED; SUSPENDED to PUBLISHED', 'Admin approval before publish; restoring a cancelled event implicitly'],
        ['Order', 'PENDING_PAYMENT to PAID, EXPIRED, FAILED, CANCELLED or PAID_NEEDS_RESOLUTION', 'Client-declared PAID; PAID to FAILED because a browser closed'],
        ['Refund', 'REQUESTED to APPROVED or REJECTED; APPROVED to PROCESSING; PROCESSING to PROCESSED or FAILED', 'REQUESTED directly to PROCESSED; approval treated as gateway completion'],
        ['Payout', 'REQUESTED to APPROVED or REJECTED; APPROVED to PAID', 'Request before event end; PAID without transfer evidence'],
        ['Guest', 'PENDING to ACCEPTED or DECLINED; credential ACTIVE to REVOKED', 'Declined guest with an active credential'],
    ], widths=[1.0, 3.15, 2.45])

    add_section_title(doc, '5 Bootstrap authentication and request pipeline')
    add_section_title(doc, '5.1 Body parsing decision', 2)
    add_body(doc, 'The current Better Auth NestJS integration documentation requires NestJS body parsing to be disabled, while Paystack signature verification requires the exact raw request bytes. NestJS native rawBody mode requires the built-in parser to remain enabled, so the implementation must not combine those settings casually. Use a route-order integration spike before feature work begins.')
    add_body(doc, 'Recommended Express approach: create NestJS with bodyParser disabled, mount the Paystack raw parser only on the webhook path, mount the Better Auth handler on /api/auth, then add JSON and URL-encoded parsing for the remaining API routes. The webhook controller receives a Buffer and parses JSON only after the HMAC check. Capture this behavior in an end-to-end test that exercises both a Better Auth request and a signed webhook in the same application instance.')
    add_code(doc, '''const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bodyParser: false,
});

app.use('/api/v1/webhooks/paystack', express.raw({
  type: 'application/json',
  limit: '1mb',
}));

// Mount the verified Better Auth integration before generic JSON parsing.
mountBetterAuth(app, auth);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));''', 'Representative bootstrap order; adapt to the exact pinned Better Auth adapter API')
    add_section_title(doc, '5.2 Authentication and profile enforcement', 2)
    add_numbered(doc, [
        'Better Auth validates the cookie session and exposes the authenticated user ID.',
        'ApplicationProfileGuard loads UserProfile by authUserId and rejects missing or BLOCKED profiles.',
        'RolesGuard checks a server-controlled role set. Public signup cannot submit role or status.',
        'Ownership remains part of the service query, such as event.id plus organizerProfileId, so a guard mistake cannot widen a query.',
        'Account blocking updates status, records the reason and actor, revokes sessions, prevents protected actions and invalidates relevant public catalog cache.',
    ])
    add_section_title(doc, '5.3 Global request controls', 2)
    add_table(doc, ['Control', 'Implementation'], [
        ['Validation', 'Global ValidationPipe with whitelist true, forbidNonWhitelisted true and transform true. DTOs express accepted fields only.'],
        ['Serialization', 'Response DTOs or mappers; never return Prisma entities or provider payloads directly.'],
        ['Errors', 'Global exception filter returns stable code, message, requestId and field details where safe.'],
        ['Rate limits', 'Tighter policies for login, reset, checkout, reconcile, RSVP and guest access. Use account and IP dimensions where possible.'],
        ['Request identity', 'Accept a trusted edge request ID or generate one; include it in logs and response headers.'],
        ['CORS and cookies', 'Allow only configured front-end origins; secure HttpOnly cookies; SameSite and domain settings tested in staging.'],
        ['OpenAPI', 'Document auth, DTOs, pagination, error codes and representative responses; exclude secret webhook internals.'],
    ], widths=[1.3, 5.3])

    doc.add_page_break()
    add_section_title(doc, '6 Prisma data model and database constraints')
    add_body(doc, 'Maintain Better Auth tables and business tables in one Prisma schema and one migration history. Better Auth owns authentication records. EverythingTicket owns UserProfile and the business aggregates. Table names may follow repository conventions, but the constraints below are required because application checks cannot prevent all concurrent races.')
    add_section_title(doc, '6.1 Aggregate groups', 2)
    add_table(doc, ['Group', 'Models', 'Required database protection'], [
        ['Identity', 'Auth user, session, account, verification; UserProfile; UserRole', 'Unique profile authUserId; role and status enums; indexed active status.'],
        ['Catalog', 'Category, Event, EventMedia, TicketType', 'Unique event slug; organizer/event indexes; state and start-time indexes.'],
        ['Commerce', 'PlatformFeeRule, Order, OrderLine, InventoryHold, PaymentAttempt', 'Unique order and attempt references; immutable snapshots; amount checks; active-hold indexes.'],
        ['Admission', 'Ticket, CheckIn', 'Unique QR digest; exactly one check-in per ticket; ticket state and event indexes.'],
        ['RSVP', 'GuestList, RsvpLink, GuestCategory, Guest, CheckIn', 'Unique link and QR digests; one check-in per guest; event/list indexes.'],
        ['Post-sale money', 'RefundRequest, RefundTicket, PayoutRequest, PayoutAdjustment', 'State checks, unique active requests where applicable, non-negative components and ledger indexes.'],
        ['Operations', 'MediaObject, NotificationOutbox, NotificationAttempt, AuditLog', 'Unique outbox key; append-only audit; object key uniqueness.'],
    ], widths=[1.1, 2.75, 2.75], font_size=8.35)
    add_section_title(doc, '6.2 Money representation', 2)
    add_bullets(doc, [
        'Use Int only when the chosen integer width safely covers projected totals; prefer BigInt for all kobo columns if an order or aggregate may exceed a signed 32-bit value.',
        'Currency is stored as a three-character code and constrained to NGN for the MVP.',
        'Order.totalKobo equals ticketSubtotalKobo plus platformFeeKobo. Enforce this in service logic and add a migration-level CHECK constraint.',
        'Refund totals equal ticket and platform-fee components. Payout calculations exclude platformFeeKobo.',
        'Percentage fees use integer basis points and one named rounding function. Write golden tests for boundary amounts.',
    ])
    add_section_title(doc, '6.3 Essential uniqueness and check constraints', 2)
    add_code(doc, '''-- Representative SQL added through a reviewed Prisma migration
ALTER TABLE "Order"
  ADD CONSTRAINT "order_total_components"
  CHECK ("totalKobo" = "ticketSubtotalKobo" + "platformFeeKobo");

CREATE UNIQUE INDEX "ticket_qr_digest_unique" ON "Ticket" ("qrTokenDigest");
CREATE UNIQUE INDEX "guest_qr_digest_unique" ON "Guest" ("qrTokenDigest")
  WHERE "qrTokenDigest" IS NOT NULL;

CREATE UNIQUE INDEX "checkin_ticket_unique" ON "CheckIn" ("ticketId")
  WHERE "ticketId" IS NOT NULL;
CREATE UNIQUE INDEX "checkin_guest_unique" ON "CheckIn" ("guestId")
  WHERE "guestId" IS NOT NULL;

CREATE UNIQUE INDEX "notification_outbox_key_unique"
  ON "NotificationOutbox" ("dedupeKey");''')
    add_section_title(doc, '6.4 Token storage', 2)
    add_body(doc, 'Generate QR, RSVP-link and guest-order tokens with a cryptographically secure random generator. Store only a keyed digest or collision-resistant hash, plus a short human-readable support code where needed. Compare digests in constant time when the library allows it. Do not log, index in analytics, or place raw tokens in audit detail. Rotation or revocation changes the stored digest or credential status immediately.')
    add_section_title(doc, '6.5 Migration policy', 2)
    add_bullets(doc, [
        'Generate migrations locally; review SQL before applying it to staging or production.',
        'Use expand-and-contract changes for non-null fields and enum changes that touch live rows.',
        'Take a production backup before migrations and record the restore procedure owner.',
        'Run migrations once from a controlled release step, not concurrently from every API process.',
        'Keep seed behavior idempotent and disabled in production unless an explicit command is run.',
    ])

    add_section_title(doc, '7 Inventory checkout and fee calculation')
    add_section_title(doc, '7.1 Quote versus order', 2)
    add_body(doc, 'A quote is a short-lived, server-computed preview and does not reserve capacity. Creating an order repeats all validation and calculations inside a transaction, creates immutable order lines and authoritative holds, then returns either a Paystack authorization target or a confirmed free order. The order endpoint accepts ticketTypeId, quantity and buyer details, not prices or totals.')
    add_section_title(doc, '7.2 Fee calculation', 2)
    add_code(doc, '''function calculatePlatformFee(subtotalKobo: bigint, rule: FeeRule): bigint {
  if (subtotalKobo === 0n && !rule.applyToFreeOrders) return 0n;
  if (rule.mode === 'FIXED') return rule.fixedAmountKobo;
  // Half-up rounding; confirm this policy before production.
  return (subtotalKobo * BigInt(rule.basisPoints) + 5_000n) / 10_000n;
}''', 'Pure domain function used by quote, order creation and test fixtures')
    add_section_title(doc, '7.3 Transaction boundary for order creation', 2)
    add_numbered(doc, [
        'Load event, organizer status and requested ticket types using the transaction client.',
        'Reject non-published events, blocked organizers, invalid sale windows, inactive ticket types and per-order-limit violations.',
        'Calculate confirmed quantity plus unexpired holds. Lock ticket-type inventory rows or use a conditional capacity update to prevent oversell.',
        'Load the single active fee rule and calculate ticket subtotal, platform fee and total using integer arithmetic.',
        'Create order, order lines, hold rows and payment attempt metadata within the transaction.',
        'For a zero total, finalize immediately inside the same transaction and write notification outbox intent.',
        'For a paid order, commit the hold first, then initialize Paystack using the unique attempt reference. If provider initialization fails, keep a diagnosable attempt state and allow controlled retry or cancellation.',
    ])
    add_section_title(doc, '7.4 Concurrency strategy', 2)
    add_body(doc, 'Use a database strategy that is explicit and testable. A conditional update can reserve capacity only when capacity minus confirmed sales minus active holds is sufficient. Where the query is impractical through Prisma, use a parameterized raw query inside the interactive transaction. Never call the root Prisma client from a helper once the transaction begins. Retry serialization failures a small bounded number of times and return a stable SOLD_OUT or CHECKOUT_CONFLICT code when capacity is gone.')
    add_section_title(doc, '7.5 Hold expiry', 2)
    add_body(doc, 'Store holdExpiresAt on the order and each hold. Availability queries ignore expired rows even if the cleanup worker is delayed. The worker later marks rows expired and updates pending orders. The initial TTL is a configuration value near ten minutes, but production must record a policy for Paystack methods that remain pending longer. An expired order never silently becomes paid and fulfilled if capacity is no longer safe; it moves to PAID_NEEDS_RESOLUTION when verified money arrives late.')

    doc.add_page_break()
    add_section_title(doc, '8 Paystack payment finalization and recovery')
    add_section_title(doc, '8.1 Payment attempt model', 2)
    add_body(doc, 'Each paid order has one or more controlled PaymentAttempt rows. Every attempt stores a unique reference, expected amount, expected currency, provider transaction ID when known, status and verification evidence. Retrying payment creates a new reference; it does not overwrite the history of the previous attempt.')
    add_section_title(doc, '8.2 Webhook processing', 2)
    add_numbered(doc, [
        'Read the raw Buffer and x-paystack-signature header.',
        'Compute HMAC-SHA512 with the Paystack secret and compare signatures safely. Reject invalid signatures before parsing the event as trusted input.',
        'Acknowledge irrelevant event types without changing business state. For charge.success, locate the attempt by reference.',
        'Call Paystack verify from the server. Require data.status success, exact reference, NGN currency and exact amount in kobo.',
        'Call the shared FinalizePaymentService used by webhook and browser reconciliation.',
        'Commit durable state before returning success. PDF generation and email run later in the worker.',
    ])
    add_section_title(doc, '8.3 Idempotent finalization transaction', 2)
    add_code(doc, '''finalizeVerifiedPayment(attemptRef, evidence) {
  return prisma.$transaction(async (tx) => {
    const attempt = await paymentRepo.lockByReference(tx, attemptRef);
    const order = await orderRepo.lockById(tx, attempt.orderId);

    if (order.status === 'PAID') return existingFulfilment(tx, order.id);
    verifyExactEvidence(attempt, evidence);

    if (!canSafelyFulfil(tx, order)) {
      await orderRepo.markPaidNeedsResolution(tx, order.id, evidence);
      await auditRepo.record(tx, 'PAYMENT_REQUIRES_RESOLUTION', order.id);
      return { status: 'PAID_NEEDS_RESOLUTION' };
    }

    await inventoryRepo.consumeHolds(tx, order.id);
    await ticketService.issueExactlyOnce(tx, order.id);
    await outboxRepo.insertOnce(tx, `order-paid:${order.id}`);
    await orderRepo.markPaid(tx, order.id, evidence);
    return { status: 'PAID' };
  });
}''', 'Illustrative orchestration; repository lock details belong in PostgreSQL-specific adapters')
    add_section_title(doc, '8.4 Browser callback and scheduled reconciliation', 2)
    add_body(doc, 'The callback page calls POST /orders/:reference/reconcile or reads a limited status endpoint. The API verifies with Paystack and invokes the same finalizer. It may return PENDING. A scheduled worker selects stale pending attempts, verifies them within provider rate limits and records outcomes. Unknown references, amount mismatch, currency mismatch or a successful provider transaction with no safe fulfillment path create reconciliation alerts for administrators.')
    add_section_title(doc, '8.5 Refund evidence', 2)
    add_body(doc, 'Admin approval authorizes a refund but does not complete it. The application may call the Paystack refund API or record an administrator action in the Paystack dashboard. In both cases, RefundRequest remains PROCESSING until a provider event or explicit verification proves completion. PROCESSED revokes the selected tickets in the same transaction and writes notification and audit intent.')

    add_section_title(doc, '9 Tickets RSVP and admission')
    add_section_title(doc, '9.1 Ticket issuance and PDF delivery', 2)
    add_bullets(doc, [
        'Create one Ticket row per purchased or free unit with immutable event, ticket-type and price snapshots.',
        'Generate a random QR secret and store only its digest. The QR contains an opaque validation token or URL.',
        'Write a PDF-generation outbox record as part of fulfillment. The worker renders the ticket, uploads it to the private R2 bucket and records the object key.',
        'Account endpoints derive the customer from the authenticated session. Guest orders require the emailed secret link and never rely on the order reference alone.',
        'Download endpoints authorize the request, then issue a short-lived presigned GET URL on the R2 S3 API domain.',
    ])
    add_section_title(doc, '9.2 RSVP link and response flow', 2)
    add_numbered(doc, [
        'Organizer creates a guest list with capacity, expiry and optional fixed category.',
        'The API creates a high-entropy link token and stores its digest. The raw token is returned once for distribution.',
        'Public GET validates enabled state and expiry and returns safe event and form fields.',
        'POST response accepts an idempotency key, revalidates capacity and fixed category, then records ACCEPTED or DECLINED.',
        'ACCEPTED creates one guest credential and notification outbox row. DECLINED creates no active credential.',
        'Organizer revocation changes credential status immediately. Reuse of the old QR returns REVOKED.',
    ])
    add_section_title(doc, '9.3 Check-in preview and confirmation', 2)
    add_table(doc, ['Result code', 'Meaning', 'Confirmation behavior'], [
        ['VALID', 'Active credential for the selected event and not used', 'Confirmation may insert the unique check-in row.'],
        ['CHECKED_IN', 'Confirmation succeeded', 'Return checkedInAt and minimal attendee display data.'],
        ['ALREADY_USED', 'A unique check-in already exists', 'Return original time; do not insert another row.'],
        ['WRONG_EVENT', 'Credential belongs to another event', 'Reject without disclosing unrelated event details.'],
        ['REVOKED', 'Ticket or guest credential is revoked', 'Reject.'],
        ['UNPAID', 'Order is not in a fulfillable paid or free state', 'Reject.'],
        ['INVALID', 'Token is unknown, malformed or expired', 'Reject with no sensitive detail.'],
    ], widths=[1.15, 2.75, 2.7])
    add_body(doc, 'Preview is informational. Confirm always revalidates ownership, event, credential state and prior use. The database uniqueness constraint decides concurrent scans. Catch the unique-constraint error and map it to ALREADY_USED with the recorded timestamp rather than returning a generic 500 response.')

    add_section_title(doc, '10 Refunds payouts and accounting records')
    add_section_title(doc, '10.1 Refund lifecycle', 2)
    add_table(doc, ['State', 'Actor', 'Required evidence'], [
        ['REQUESTED', 'Organizer', 'Owned paid order, affected ticket IDs, amount components and reason.'],
        ['APPROVED', 'Administrator', 'Exact approved ticket and platform-fee amounts plus decision audit.'],
        ['REJECTED', 'Administrator', 'Decision reason and audit record.'],
        ['PROCESSING', 'System or administrator', 'Provider refund reference or recorded Paystack dashboard action.'],
        ['PROCESSED', 'System after reconciliation', 'Verified provider completion; affected tickets revoked.'],
        ['FAILED', 'System after reconciliation', 'Provider failure evidence and retry/support path.'],
    ], widths=[1.1, 1.45, 4.05])
    add_section_title(doc, '10.2 Payout calculation', 2)
    add_code(doc, '''calculatedPayableKobo =
  paidTicketSubtotalKobo
  - processedOrganizerLiableRefundKobo
  - reservedPendingRefundKobo
  + auditedAdjustmentsKobo
  - priorPaidPayoutKobo''')
    add_body(doc, 'The customer-paid platform fee does not enter organizer payable revenue. The server computes the maximum requestable amount after the event end time. Lock the event payout ledger while creating or approving a request. Admin marks PAID only after the external bank transfer succeeds and a transfer reference and date are recorded. A later organizer-liable refund after payout becomes a negative balance or receivable; it is never silently funded by unrelated platform revenue.')
    add_section_title(doc, '10.3 Audit records', 2)
    add_body(doc, 'AuditLog is append-only and captures actor user/profile, action, target type and ID, timestamp, request ID, reason and a minimized before/after change set. Mandatory audit events include role or status changes, account blocking, event suspension, fee-rule replacement, payment exception resolution, refund decisions, payout decisions, manual transfer recording, ticket revocation and privileged resend actions. Do not store raw tokens, secrets or full provider payloads in audit detail.')

    doc.add_page_break()
    add_section_title(doc, '11 REST API conventions and endpoint map')
    add_section_title(doc, '11.1 Response conventions', 2)
    add_code(doc, '''// Success
{
  "data": { ... },
  "meta": { "requestId": "req_..." }
}

// Error
{
  "error": {
    "code": "CHECKOUT_SOLD_OUT",
    "message": "The requested quantity is no longer available",
    "fields": [{ "field": "items[0].quantity", "code": "CAPACITY_EXCEEDED" }]
  },
  "meta": { "requestId": "req_..." }
}''')
    add_body(doc, 'Use cursor or page pagination consistently within each collection. Dates are ISO 8601 UTC strings. Event responses also include the event timeZone. BigInt money values are serialized as decimal strings or validated safe integers according to the selected client contract; choose one convention before frontend integration and document it in OpenAPI.')
    add_section_title(doc, '11.2 Endpoint groups', 2)
    add_table(doc, ['Area', 'Representative routes', 'Auth'], [
        ['Authentication', '/api/auth/*; GET /api/v1/account/me', 'Better Auth public/session routes; account requires session'],
        ['Public catalog', 'GET /categories; GET /events; GET /events/:slug', 'Anonymous'],
        ['Customer', 'GET /account/orders; GET /account/tickets; GET /account/tickets/:id/download', 'Customer and ownership'],
        ['Checkout', 'POST /orders/quote; POST /orders; GET /orders/:reference/status; POST /orders/:reference/reconcile', 'Authenticated customer; secret guest flow only if enabled'],
        ['Webhook', 'POST /webhooks/paystack', 'Paystack signature plus verification'],
        ['Organizer events', 'GET/POST/PATCH /organizer/events; publish; ticket types; media', 'Organizer and ownership'],
        ['Organizer operations', 'dashboard; orders; attendees; CSV; refund requests; payout requests', 'Organizer and ownership'],
        ['RSVP', 'Organizer guest-list routes; GET/POST /rsvp/:token', 'Organizer ownership or secret link'],
        ['Check-in', 'preview; confirm; summary', 'Organizer and event ownership'],
        ['Administration', 'users; events; orders; refunds; payouts; fee rule; summary', 'Administrator'],
    ], widths=[1.25, 3.85, 1.5], font_size=8.15)
    add_section_title(doc, '11.3 Error catalog', 2)
    add_table(doc, ['HTTP', 'Stable code examples', 'Usage'], [
        ['400', 'VALIDATION_ERROR, INVALID_FILTER', 'Malformed or semantically invalid input.'],
        ['401', 'AUTH_REQUIRED, SESSION_EXPIRED', 'Missing or invalid authenticated session.'],
        ['403', 'ACCOUNT_BLOCKED, ROLE_FORBIDDEN', 'Known caller lacks role or is blocked.'],
        ['404', 'RESOURCE_NOT_FOUND', 'Missing or owner-scoped resource; avoid cross-user disclosure.'],
        ['409', 'CHECKOUT_SOLD_OUT, ALREADY_CHECKED_IN, STATE_CONFLICT', 'Current state prevents the requested mutation.'],
        ['422', 'PAYMENT_MISMATCH, PAYOUT_NOT_ELIGIBLE', 'Request is structurally valid but fails a business rule requiring detail.'],
        ['429', 'RATE_LIMITED', 'Endpoint-specific rate limit exceeded.'],
        ['503', 'DEPENDENCY_UNAVAILABLE', 'Required managed service unavailable; never misreport success.'],
    ], widths=[0.55, 2.85, 3.2])

    add_section_title(doc, '12 Jobs outbox delivery and scheduled work')
    add_section_title(doc, '12.1 Queue topology', 2)
    add_table(doc, ['Queue', 'Job names', 'Source of durable intent', 'Retry rule'], [
        ['notifications', 'send-order, send-rsvp, send-refund, send-payout', 'NotificationOutbox', 'Exponential backoff; dedupe by outbox ID.'],
        ['documents', 'generate-ticket-pdf', 'Ticket PDF status row', 'Retry safe because R2 key is deterministic.'],
        ['payments', 'reconcile-attempt, reconcile-refund', 'PaymentAttempt or RefundRequest', 'Rate limited; stop on terminal verified state.'],
        ['maintenance', 'expire-holds, clean-orphan-media', 'Database query plus schedule cursor', 'Idempotent batch; record last success.'],
        ['outbox', 'dispatch', 'Undispatched outbox rows', 'Short interval; claim rows with locking.'],
    ], widths=[1.1, 1.55, 2.25, 1.7], font_size=8.25)
    add_section_title(doc, '12.2 Outbox dispatch', 2)
    add_body(doc, 'The business transaction inserts an outbox row with a unique dedupeKey. A dispatcher claims a batch using PostgreSQL row locking, publishes each item to BullMQ with jobId equal to the outbox ID, then marks it dispatched. If the process fails after publishing but before marking, BullMQ job IDs prevent duplicate active jobs and the worker remains idempotent. Redis loss may require redispatch, but PostgreSQL retains the intent.')
    add_section_title(doc, '12.3 Worker handler rules', 2)
    add_bullets(doc, [
        'Jobs contain stable IDs only. Load the latest state before performing an external side effect.',
        'Use deterministic provider idempotency keys where supported and store provider references.',
        'Record each attempt, latency, error class and next retry without logging secrets or personal payloads.',
        'A resend action creates a new delivery attempt against the same ticket or message; it does not reissue business objects.',
        'Configure queue retention so failed jobs remain available for diagnosis without allowing Redis to grow without bound.',
    ])

    add_section_title(doc, '13 Security and privacy controls')
    add_table(doc, ['Risk', 'Required control'], [
        ['Broken object authorization', 'Derive account identity from session; include organizer/customer ownership in database predicates; use 404 for secret resources where disclosure matters.'],
        ['Privilege escalation', 'Ignore public role/status fields; provision admins deliberately; audit every privileged role or status mutation.'],
        ['Webhook forgery', 'Use exact raw bytes, HMAC-SHA512 verification and server-to-server transaction verification.'],
        ['Replay and double fulfillment', 'Unique references, order locks, state guards, unique tickets/outbox keys and shared idempotent finalization.'],
        ['Overselling', 'PostgreSQL transaction plus conditional capacity reservation or row locks; concurrency tests against a real test database.'],
        ['Token theft', 'High-entropy tokens, digest storage, short expiry where suitable, secure cookies, redacted logs and immediate revocation.'],
        ['CSV injection', 'Prefix fields beginning with =, +, - or @ and use correct CSV quoting. Export only required columns.'],
        ['Unsafe uploads', 'Allowlist image MIME types, check actual file signature and size, bind object keys to owner/event, and clean orphaned uploads.'],
        ['Secret exposure', 'VPS environment files readable only by service account; separate test/live keys; no secrets in source, logs, OpenAPI or queue payloads.'],
        ['Data retention', 'Document retention for buyer data, PDFs, logs and audit; implement deletion only where it does not destroy required financial records.'],
    ], widths=[1.45, 5.15], font_size=8.3)
    add_section_title(doc, '13.1 Logging policy', 2)
    add_body(doc, 'Structured logs may include requestId, internal order ID, public order reference, event ID, attempt ID, queue job ID, result code and duration. Do not log session cookies, Paystack keys, complete provider payloads, full buyer records, raw QR or RSVP tokens, presigned URLs, reset tokens or card data. Hash IP addresses if retained beyond immediate security analysis and document the retention period.')

    doc.add_page_break()
    add_section_title(doc, '14 Testing and acceptance evidence')
    add_section_title(doc, '14.1 Test layers', 2)
    add_table(doc, ['Layer', 'Purpose', 'Required examples'], [
        ['Unit', 'Pure policies and state transitions', 'Fee rounding, payout eligibility, transition maps, token digest helpers, CSV escaping.'],
        ['Repository integration', 'Prisma queries, migrations and constraints', 'Ownership scope, unique QR/check-in, amount checks, outbox dedupe.'],
        ['Concurrency', 'Races against real PostgreSQL', 'Last-ticket holds, duplicate payment finalization, simultaneous check-in, duplicate payout request.'],
        ['Provider integration', 'Adapter behavior in test mode', 'Paystack initialization/verification/refund status, R2 upload/signing, email sandbox.'],
        ['HTTP end to end', 'Middleware, auth, DTOs and response contracts', 'Better Auth plus webhook body parsing, blocked user, account isolation, OpenAPI examples.'],
        ['Operational', 'Deployment and recovery behavior', 'Worker restart, Redis flush recovery from outbox, database restore rehearsal, rollback.'],
        ['Device rehearsal', 'Real gate workflow', 'iPhone Safari and Android Chrome scan, poor-network messaging and duplicate scan.'],
    ], widths=[1.2, 2.05, 3.35], font_size=8.35)
    add_section_title(doc, '14.2 Financial and admission acceptance matrix', 2)
    add_table(doc, ['ID', 'Scenario', 'Evidence required'], [
        ['A01', 'Two buyers request the last ticket', 'One valid hold; other receives SOLD_OUT or conflict; no negative availability.'],
        ['A02', 'Hold expiry races with charge success', 'Paid state is preserved; safe fulfillment or PAID_NEEDS_RESOLUTION.'],
        ['A03', 'Webhook is replayed and reconcile runs simultaneously', 'One fulfillment, exact ticket count and one notification outbox key.'],
        ['A04', 'Signature, amount, currency or reference mismatch', 'No ticket issuance; security or reconciliation record created.'],
        ['A05', 'Fee rule changes after quote or purchase', 'Order is recomputed at creation; historical paid order keeps its snapshot.'],
        ['A06', 'Paystack payload inspection', 'Initialized amount equals displayed total; no split, subaccount or transfer instruction.'],
        ['A07', 'Free order', 'No Paystack attempt required; transaction issues exact tickets and outbox intent.'],
        ['A08', 'Customer cross-account access', 'List, detail and download queries disclose no other customer data.'],
        ['A09', 'Blocked organizer', 'Protected actions fail and public events stop accepting checkout; explicit suspension remains independent.'],
        ['A10', 'Direct organizer publish', 'Valid event publishes without admin approval; invalid event returns field errors.'],
        ['A11', 'Concurrent QR confirmation', 'One CHECKED_IN and one ALREADY_USED with original time.'],
        ['A12', 'Cross-organizer access', 'Events, guests, attendees, media, refunds, payouts and scans remain owner-scoped.'],
        ['A13', 'Refund approval', 'Approval does not mark completion; verified processing revokes selected tickets.'],
        ['A14', 'Payout request', 'Cannot run before event end, exceed payable or pay twice; no automatic transfer.'],
        ['A15', 'Restricted RSVP category', 'Guest cannot elevate category; revoked link and credential fail immediately.'],
        ['A16', 'Email or R2 failure after payment', 'Order remains paid; retry delivers without duplicate tickets.'],
    ], widths=[0.48, 2.65, 3.47], font_size=7.8)
    add_section_title(doc, '14.3 Continuous integration gates', 2)
    add_bullets(doc, [
        'Type check, lint, unit tests and generated-client drift check.',
        'Apply all migrations to an empty database, then apply them to a representative previous schema snapshot.',
        'Run repository, concurrency and HTTP end-to-end suites against isolated PostgreSQL and Redis services in CI.',
        'Generate OpenAPI and fail on unintended contract drift.',
        'Scan dependencies and source for exposed secrets; build both API and worker entry points.',
        'Do not declare a module complete until its failure-mode tests and ownership tests pass.',
    ])

    add_section_title(doc, '15 Infrastructure and deployment')
    add_section_title(doc, '15.1 Production topology', 2)
    add_table(doc, ['Component', 'Placement', 'Configuration requirement'], [
        ['Cloudflare', 'Edge', 'DNS, HTTPS, proxy/WAF and public media domain.'],
        ['Nginx or Caddy', 'VPS', 'Reverse proxy to API, body-size limits, timeouts and trusted proxy headers.'],
        ['everythingticket-api.service', 'VPS systemd', 'Runs compiled main entry point as unprivileged service user.'],
        ['everythingticket-worker.service', 'VPS systemd', 'Runs compiled worker entry point with independent restart and resource policy.'],
        ['PostgreSQL', 'Managed external service', 'TLS, backups, restore test, pool limits and network restrictions.'],
        ['Redis', 'Managed external service', 'TLS, isolated credentials, persistence appropriate to queue use and memory policy.'],
        ['Cloudflare R2', 'Managed object storage', 'Separate public-media and private-ticket access policy.'],
        ['Email provider', 'Managed service', 'Verified sender, domain authentication and delivery event retention.'],
    ], widths=[1.6, 1.5, 3.5], font_size=8.5)
    add_section_title(doc, '15.2 Systemd services', 2)
    add_code(doc, '''[Unit]
Description=EverythingTicket API
After=network-online.target

[Service]
Type=simple
User=everyticket
WorkingDirectory=/opt/everyticket/current
EnvironmentFile=/etc/everyticket/api.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/log/everyticket

[Install]
WantedBy=multi-user.target''', 'Representative API unit; worker uses dist/worker.js and a separate environment file')
    add_section_title(doc, '15.3 Release procedure', 2)
    add_numbered(doc, [
        'Run the full CI gate and produce an immutable release artifact.',
        'Back up PostgreSQL and confirm the restore owner before a production migration.',
        'Upload the release to a versioned directory on the VPS and install production dependencies from the lockfile.',
        'Run Prisma migration deployment once from the release process.',
        'Switch the current symlink, restart worker and API in the documented order, then run readiness and smoke tests.',
        'Verify Better Auth session behavior, public catalog, a test-mode payment path where safe, queue health and presigned download generation.',
        'If health checks fail, roll back application code. Use forward-compatible migrations so ordinary rollback does not require destructive schema reversal.',
    ])
    add_section_title(doc, '15.4 Environment variables', 2)
    add_table(doc, ['Group', 'Variables'], [
        ['Application', 'NODE_ENV, PORT, PUBLIC_APP_URL, API_BASE_URL, TRUSTED_ORIGINS, LOG_LEVEL'],
        ['Database', 'DATABASE_URL, DIRECT_DATABASE_URL where provider requires it, DB_POOL_SIZE'],
        ['Redis and queues', 'REDIS_URL, QUEUE_PREFIX, WORKER_CONCURRENCY, OUTBOX_BATCH_SIZE'],
        ['Better Auth', 'BETTER_AUTH_SECRET, BETTER_AUTH_URL and provider-specific email/reset settings'],
        ['Paystack', 'PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY only where needed, PAYSTACK_BASE_URL'],
        ['R2', 'R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BUCKET, R2_PRIVATE_BUCKET, MEDIA_PUBLIC_URL'],
        ['Email', 'EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM_NAME, EMAIL_FROM_ADDRESS'],
        ['Business timing', 'CHECKOUT_HOLD_SECONDS, SIGNED_DOWNLOAD_SECONDS, RECONCILIATION_AGE_SECONDS'],
    ], widths=[1.45, 5.15], font_size=8.3)
    add_body(doc, 'The active platform-fee rule belongs in PostgreSQL and is not an environment variable. Secret values live outside the release directory with permissions restricted to the service account. Staging and production use different Better Auth, Paystack, R2, database, Redis and email credentials.')

    doc.add_page_break()
    add_section_title(doc, '16 Monitoring and operational runbooks')
    add_section_title(doc, '16.1 Health endpoints', 2)
    add_table(doc, ['Endpoint', 'Purpose', 'Behavior'], [
        ['/health/live', 'Process liveness', 'Returns quickly without external dependencies.'],
        ['/health/ready', 'Traffic readiness', 'Checks database connectivity and essential configuration; may include Redis with a short timeout.'],
        ['/internal/worker-health', 'Operator-only worker status', 'Reports last successful outbox dispatch and scheduled job timestamps.'],
    ], widths=[1.55, 2.1, 2.95])
    add_section_title(doc, '16.2 Metrics and alerts', 2)
    add_table(doc, ['Signal', 'Alert condition'], [
        ['API error rate and latency', 'Sustained increase by route group or dependency.'],
        ['Database connections and transaction retries', 'Pool exhaustion, connection errors or repeated serialization failures.'],
        ['Pending payment age', 'Attempts remain pending beyond the configured reconciliation window.'],
        ['Payment exception count', 'Any PAID_NEEDS_RESOLUTION or amount/currency mismatch.'],
        ['Queue lag and oldest outbox age', 'Work is not dispatching or consumers are falling behind.'],
        ['Failed notification or PDF jobs', 'Retries exhausted or provider errors increase.'],
        ['Invalid scan rate', 'Unusual spike by event, IP range or device.'],
        ['Disk, CPU and memory', 'VPS approaches safe capacity or restarts repeatedly.'],
        ['Backup freshness', 'Expected PostgreSQL backup or restore verification is missing.'],
    ], widths=[2.35, 4.25])
    add_section_title(doc, '16.3 Required runbooks', 2)
    add_bullets(doc, [
        'Payment received but ticket not issued: verify provider evidence, inspect finalization state, resolve PAID_NEEDS_RESOLUTION, never manually invent a PAID state.',
        'Queue outage: restore Redis, run outbox dispatcher, confirm dedupe behavior and monitor oldest pending intent.',
        'Email or PDF delivery failure: retry the existing outbox record; do not reissue tickets.',
        'Duplicate or disputed check-in: inspect unique CheckIn row, actor and timestamp; never delete gate history to admit a second use.',
        'Database incident: stop writes if consistency is uncertain, restore according to the tested procedure and reconcile Paystack transactions for the affected interval.',
        'Compromised token: revoke the credential or link, rotate where supported, notify affected parties and preserve an audit record without storing the raw token.',
        'Deployment rollback: restore previous release, validate schema compatibility, restart worker/API and run smoke tests.',
    ])

    add_section_title(doc, '17 Delivery plan and completion criteria')
    add_table(doc, ['Phase', 'Primary deliverables', 'Exit evidence'], [
        ['0 Foundation', 'Repository audit, configuration, API and worker boot, Prisma setup, health, logs and CI', 'Both entry points build; migrations run; health and logging tests pass.'],
        ['1 Identity and catalog', 'Better Auth, profile hook, roles/status, blocking, events, ticket types, direct publish and public catalog', 'Session/raw-body integration test; ownership and blocked-account suites pass.'],
        ['2 Commerce core', 'Fee versions, quote, holds, orders, free flow, Paystack initialization, webhook/reconcile and ticket history', 'Concurrency, fee, replay, mismatch and account isolation tests pass.'],
        ['3 Admission', 'Ticket PDF delivery, RSVP, credential validation and atomic check-in', 'Concurrent scan, revoked, wrong-event and RSVP-category suites pass.'],
        ['4 Post-sale operations', 'Dashboards, CSV, refund workflow, payout ledger, media, admin summaries and audit', 'Money component, lifecycle, ownership and audit tests pass.'],
        ['5 Production readiness', 'Systemd, proxy, monitoring, backup/restore, load check, device rehearsal and handover', 'Staging acceptance record, rollback rehearsal and resolved production decisions.'],
    ], widths=[1.0, 3.55, 2.05], font_size=8.1)
    add_section_title(doc, '17.1 Definition of done for each module', 2)
    add_bullets(doc, [
        'Prisma migration and indexes are reviewed and reproducible.',
        'DTOs, response mappers, authentication and ownership rules are implemented.',
        'Domain transitions and transaction boundaries are explicit in service code.',
        'OpenAPI documents success and error responses with stable machine-readable codes.',
        'Unit, integration, ownership and failure-mode tests pass against required real services.',
        'Logs, metrics and operator remediation are documented.',
        'No feature is marked complete from a happy-path controller alone.',
    ])

    add_section_title(doc, '18 Production decisions and implementation references')
    add_section_title(doc, '18.1 Decisions required before live launch', 2)
    add_table(doc, ['Decision', 'Owner record must specify'], [
        ['Managed PostgreSQL and Redis', 'Provider, region, TLS, network policy, connection limits, backup retention, restore owner and tested date.'],
        ['Checkout hold', 'TTL, delayed-payment policy and operator handling for verified payment after expiry.'],
        ['Platform fee', 'Initial mode/value, rounding rule, fixed per-order or per-ticket meaning, free-order policy and authorized admin roles.'],
        ['Paystack charges', 'Whether the platform fee absorbs processing charges and how accounting reports display them.'],
        ['Refunds', 'Limits, evidence, API or dashboard execution, partial-refund ticket mapping and restock policy.'],
        ['Payouts', 'Review evidence, waiting period, bank transfer method, adjustment policy and negative-balance recovery.'],
        ['RSVP', 'Limit behavior, open or invited link model, required contact fields and restricted-category policy.'],
        ['Additional staff features', 'Whether event-scoped staff or administrator-created events are approved through a change request.'],
        ['Privacy and retention', 'Buyer-data, logs, ticket PDF and audit retention plus approved policy text.'],
    ], widths=[1.55, 5.05], font_size=8.2)
    add_section_title(doc, '18.2 Implementation assumptions in this guide', 2)
    add_bullets(doc, [
        'Express is the initial NestJS HTTP adapter because the current Better Auth integration and raw webhook parser can be tested with a clear middleware order.',
        'The fee percentage uses half-up rounding until the business owner records another rule.',
        'Free orders have no platform fee unless an explicit rule later enables one.',
        'Organizer-authenticated scanning is the MVP gate model; separate staff accounts remain out of scope.',
        'Paystack collects customer funds to the platform account; organizer payout is an approved manual external transfer.',
    ])
    add_section_title(doc, '18.3 Official implementation references', 2)
    refs = [
        ('NestJS raw request body', 'https://docs.nestjs.com/faq/raw-body'),
        ('NestJS queues with BullMQ', 'https://docs.nestjs.com/techniques/queues'),
        ('Better Auth NestJS integration', 'https://better-auth.com/docs/integrations/nestjs'),
        ('Better Auth Prisma adapter', 'https://better-auth.com/docs/adapters/prisma'),
        ('Prisma transactions', 'https://www.prisma.io/docs/orm/prisma-client/queries/transactions'),
        ('Paystack accept payments', 'https://paystack.com/docs/payments/accept-payments/'),
        ('Paystack verify payments', 'https://paystack.com/docs/payments/verify-payments/'),
        ('Paystack webhooks', 'https://paystack.com/docs/payments/webhooks/'),
        ('Paystack refunds', 'https://paystack.com/docs/payments/refunds/'),
        ('Cloudflare R2 S3 compatibility', 'https://developers.cloudflare.com/r2/api/s3/api/'),
        ('Cloudflare R2 presigned URLs', 'https://developers.cloudflare.com/r2/api/s3/presigned-urls/'),
    ]
    for text, url in refs:
        p = doc.add_paragraph(style='List Bullet')
        hyperlink(p, text, url)
    add_body(doc, 'These references were checked on 19 October 2026. The implementation team must recheck exact APIs and compatibility against the versions pinned in the repository before coding or upgrading integrations.')

    add_section_title(doc, '18.4 Final engineering handover')
    add_body(doc, 'Handover is complete when the repository contains reviewed migrations, generated OpenAPI, environment examples without secrets, API and worker systemd units, backup and restore steps, deployment and rollback scripts, monitoring dashboards, operational runbooks, seed guidance, the full automated test suite and a staging acceptance record. The handover must also list every unresolved business decision and identify the owner who will resolve it before production traffic.')

    # Document core properties
    props = doc.core_properties
    props.title = 'EverythingTicket NestJS Backend Implementation'
    props.subject = 'Backend architecture and implementation guide for the EverythingTicket MVP'
    props.author = 'EverythingTicket'
    props.keywords = 'NestJS, Prisma, Better Auth, PostgreSQL, Redis, BullMQ, Paystack, Cloudflare R2'
    props.comments = 'Prepared from the EverythingTicket Backend Development Specification version 1.1.'

    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == '__main__':
    build_document()
