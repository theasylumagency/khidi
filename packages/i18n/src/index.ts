import type { SupportedLocale, UserRole } from "@khidi/shared";

export interface NavItem {
  key: string;
  href: string;
  labelKa: string;
  labelEn: string;
  adminOnly?: boolean;
  allowedRoles: UserRole[];
}

/**
 * Primary navigation items matching §13.4.
 * Core: პროდუქტები · მარაგი · ფასები · დავალებები · მიწოდება · შეტყობინებები · ისტორია · პარამეტრები
 * Admin additionally: მტკიცებულებები, მომხმარებლები, იურიდიული პირები, მაღაზიები, ანგარიშები
 */
export const NAVIGATION_ITEMS: readonly NavItem[] = [
  {
    key: "products",
    href: "/products",
    labelKa: "პროდუქტები",
    labelEn: "Products",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER"]
  },
  {
    key: "inventory",
    href: "/inventory",
    labelKa: "მარაგი",
    labelEn: "Inventory",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "WAREHOUSE"]
  },
  {
    key: "prices",
    href: "/prices",
    labelKa: "ფასები",
    labelEn: "Prices",
    allowedRoles: ["ADMIN", "OPERATOR"]
  },
  {
    key: "tasks",
    href: "/tasks",
    labelKa: "დავალებები",
    labelEn: "Tasks",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "WAREHOUSE"]
  },
  {
    key: "fulfillment",
    href: "/fulfillment",
    labelKa: "მიწოდება",
    labelEn: "Fulfillment",
    allowedRoles: ["ADMIN", "OPERATOR", "WAREHOUSE", "ORDER_MANAGER"]
  },
  {
    key: "notifications",
    href: "/notifications",
    labelKa: "შეტყობინებები",
    labelEn: "Notifications",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "WAREHOUSE", "ORDER_MANAGER"]
  },
  {
    key: "history",
    href: "/history",
    labelKa: "ისტორია",
    labelEn: "Audit History",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER"]
  },
  {
    key: "settings",
    href: "/settings",
    labelKa: "პარამეტრები",
    labelEn: "Settings",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  // Admin-only navigation items (§13.4)
  {
    key: "evidence",
    href: "/evidence",
    labelKa: "მტკიცებულებები",
    labelEn: "Evidence",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "users",
    href: "/users",
    labelKa: "მომხმარებლები",
    labelEn: "Users",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "legal_entities",
    href: "/entities",
    labelKa: "იურიდიული პირები",
    labelEn: "Legal Entities",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "storefronts",
    href: "/storefronts",
    labelKa: "მაღაზიები",
    labelEn: "Storefronts",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "reports",
    href: "/reports",
    labelKa: "ანგარიშები",
    labelEn: "Reports",
    adminOnly: false,
    allowedRoles: ["ADMIN", "STOCK_MANAGER"]
  }
] as const;

export function getNavigationForRole(role: UserRole): NavItem[] {
  return NAVIGATION_ITEMS.filter((item) => item.allowedRoles.includes(role))
    .map((item) => item.key === "tasks" && role !== "ADMIN" ? { ...item, href: "/warehouse/tasks" } : item);
}

/** Legacy seed names may include a role/affiliation annotation; display the person's name. */
export function formatStaffName(fullName: string): string {
  return fullName.replace(/\s+\([^()]*\)\s*$/u, "").trim();
}

const SCANNING_LABELS = {
  "media.photo_request": "ფოტოს მოთხოვნა",
  "media.request_created": "ფოტოს მოთხოვნა შეიქმნა და შემსრულებლის დავალებებში გამოჩნდება.",
  "media.open_request": "ფოტოების გადაღება",
  "media.request_note": "რა უნდა ჩანდეს ფოტოზე",
  "media.request_slots": "საჭირო ხედები",
  "media.request_saved": "ფოტოები და შენიშვნა შენახულია. გასაგზავნი ფოტოები ზემოთ ჩანს.",
  "media.request_new": "ახალი ფოტოს მოთხოვნა",
  "media.jobs": "ფოტოების დამუშავება",
  "media.job_type": "სამუშაო",
  "media.attempts": "მცდელობები",
  "media.updated_at": "განახლდა",
  "media.failure": "შეცდომა",
  "media.actions": "ქმედებები",
  "media.retry_job": "ხელახლა გაშვება",
  "media.job.process-image": "ასლების შექმნა",
  "media.job.tier2-image-check": "ხარისხის შემოწმება",
  "media.job.publish-sku-media": "საჯარო ასლების განახლება",
  "media.job_status.PENDING": "მოლოდინში",
  "media.job_status.PROCESSING": "მუშავდება",
  "media.job_status.RETRY": "განმეორებით ცდას ელოდება",
  "media.job_status.COMPLETED": "დასრულებულია",
  "media.job_status.DEAD_LETTER": "შეჩერებულია — საჭიროებს შემოწმებას",
  "media.pending_photos": "გასაგზავნი ფოტოები",
  "media.storage_used": "საცავი: {used} / {quota} მბ",
  "media.quota_warning": "საცავის 80% შევსებულია. დაუკავშირდით ქსელს ფოტოების გასაგზავნად.",
  "media.quota_blocked": "საცავის 95% შევსებულია. ახალი ფოტოს გადაღებამდე გააგზავნეთ შენახული ფოტოები. არაფერი წაიშლება თავისით.",
  "media.other_user_photos": "სხვა თანამშრომლების {count} ფოტო მათ შესვლას ელოდება.",
  "media.waiting_for_photos": "{name}: {count} ფოტო მის შესვლას ელოდება.",
  "media.discard_scan_confirm": "სკანი და მისი {count} ფოტო წაიშლება. მიზეზი და ფოტოების მონაცემები ადმინს გაეგზავნება. დაადასტურეთ გაუქმება.",
  "media.photos_under_scan": "ამ სკანზე მიბმულია {count} ფოტო. ისინი სკანის გაგზავნას ელოდება.",
  "media.blocked_parent": "ფოტო დაბლოკილ სკანზეა მიბმული და ცალკე არ გაიგზავნება.",
  "media.blocked_photo": "ფოტოს გაგზავნა დაბლოკილია.",
  "media.waiting_upload": "ფოტო გაგზავნის რიგშია.",
  "media.discard_photo_confirm": "ფოტო რიგიდან წაიშლება. მიზეზი ადმინს გაეგზავნება. დაადასტურეთ გაუქმება.",
  "media.retake_confirm": "ძველი დაბლოკილი ფოტო გაუქმდება მხოლოდ ახალი ფოტოს შენახვის შემდეგ. დაადასტურეთ.",
  "media.retake_reason": "მფლობელმა დაბლოკილი ფოტო ხელახლა გადაიღო.",
  "media.retake": "ხელახლა გადაღება",
  "media.retake_failed": "ახალი ფოტო ვერ იქნა მიღებული. ძველი ფოტო რიგში დარჩა. სცადეთ ხელახლა.",
  "media.retry_photos": "ფოტოების გაგზავნის გამეორება",
  "media.photos_complete": "სავალდებულო ფოტოები მიღებულია.",
  "media.capture_title": "პროდუქტის ფოტოები",
  "media.slot.MAIN": "მთავარი ხედი",
  "media.slot.SECONDARY": "გვერდითი ხედი",
  "media.slot.IDENTIFICATION": "მოდელის ფირფიტა",
  "media.slot.EXTRA": "დამატებითი ფოტო",
  "media.instruction.MAIN": "პროდუქტი მთლიანად ჩანდეს. კიდეები არ მოიჭრას.",
  "media.instruction.SECONDARY": "გადაიღეთ გვერდიდან ან დაახლოებით 45° კუთხით.",
  "media.instruction.IDENTIFICATION": "ახლოდან გადაიღეთ მოდელი, ფირფიტა ან ტექნიკური წარწერა.",
  "media.instruction.EXTRA": "მკაფიოდ გადაიღეთ მოთხოვნილი დეტალი.",
  "media.required": "სავალდებულო",
  "media.slot_already_covered": "ფოტო უკვე არსებობს — გამოტოვება ან ხელახლა გადაღება",
  "media.skip_optional": "გამოტოვება",
  "media.already_scanned": "უკვე დასკანერებულია",
  "media.complete_photos": "ფოტოების დასრულება",
  "media.frame_hint": "პროდუქტი ჩარჩოში მოაქციეთ და მთლიანად დატოვეთ კადრში.",
  "media.camera_preview": "ფოტოკამერის ხედი",
  "media.last_photo": "ბოლოს გადაღებული ფოტო",
  "media.native_capture": "კამერით გადაღება",
  "media.pick_file": "ფოტოს არჩევა",
  "media.live_camera": "კამერის ჩართვა ჩარჩოთი",
  "media.take_photo": "ფოტოს გადაღება",
  "media.photo_accepted": "✓ ფოტო მიღებულია",
  "media.checking_photo": "ფოტო მოწმდება…",
  "media.storage_error": "ფოტო ვერ შეინახა. მიღება არ დადასტურებულა. სცადეთ ხელახლა.",
  "media.use_native_resolution": "ამ ხედის გარჩევადობა მცირეა. გამოიყენეთ „კამერით გადაღება“.",
  "media.finish_capture": "შემდეგი პროდუქტის სკანირება",
  "media.required_pending": "დარჩა {count} სავალდებულო ფოტო.",
  "media.cannot_photo": "ვერ ვიღებ ფოტოს",
  "media.cannot_reason": "ჩაწერეთ მიზეზი ადმინისთვის",
  "media.save_reason": "მიზეზის შენახვა და გაგრძელება",
  "media.error.GENERIC": "ფოტოს შენახვა ვერ მოხერხდა. ფოტო რიგში დარჩება.",
  "media.error.FILE_TOO_LARGE": "ფოტო 15 მბ-ზე დიდია. გადაიღეთ სხვა ფოტო.",
  "media.error.UNSUPPORTED_FORMAT": "მიიღება მხოლოდ JPEG, PNG ან WebP ფოტო.",
  "media.error.RESOLUTION": "ფოტოს ზომა მცირეა. გადაიღეთ მაღალი გარჩევადობით.",
  "media.error.UNDEREXPOSED": "ფოტო ძალიან ბნელია. გაზარდეთ განათება და გადაიღეთ თავიდან.",
  "media.error.OVEREXPOSED": "ფოტო ძალიან ნათელია. შეამცირეთ განათება და გადაიღეთ თავიდან.",
  "media.error.BLUR": "⚠ ფოტო ბუნდოვანია, გადაიღეთ თავიდან",
  "media.error.DEPENDENCY_PENDING": "ფოტო ელოდება თავისი სკანის გაგზავნას.",
  "media.error.TARGET_UNAVAILABLE": "ფოტოს დავალება დასრულებულია ან გაუქმებულია. ფოტო რიგში ინახება.",
  "scanner.my_tasks": "ჩემი დავალებები",
  "scanner.empty_tasks": "ამჟამად მიღების დავალება არ გაქვთ.",
  "scanner.open": "სკანირების დაწყება",
  "scanner.back": "დავალებებთან დაბრუნება",
  "scanner.camera": "კამერით სკანირება",
  "scanner.camera_start": "კამერის ჩართვა",
  "scanner.camera_stop": "კამერის გამორთვა",
  "scanner.camera_starting": "კამერა ირთვება…",
  "scanner.camera_permission": "კამერაზე წვდომა გამორთულია. დაუშვით წვდომა ბრაუზერის პარამეტრებში და სცადეთ ხელახლა. კოდი შეგიძლიათ ხელითაც შეიყვანოთ.",
  "scanner.camera_unavailable": "კამერა ვერ ჩაირთო. სცადეთ ხელახლა ან შეიყვანეთ კოდი ხელით.",
  "scanner.camera_interrupted": "კამერა შეჩერდა. გასაგრძელებლად ჩართეთ ხელახლა.",
  "scanner.camera_hint": "მოაქციეთ ერთი კოდი ჩარჩოში. მიღების შემდეგ გადადით შემდეგ პროდუქტზე.",
  "scanner.retry_camera": "კამერის ხელახლა ჩართვა",
  "scanner.torch_on": "ფანრის ჩართვა",
  "scanner.torch_off": "ფანრის გამორთვა",
  "scanner.manual": "კოდის ხელით შეყვანა",
  "scanner.progress_hint": "დადასტურებული რაოდენობა. მოლოდინში მყოფი სკანები ზემოთ ჩანს.",
  "scanner.progress_unavailable": "პროგრესის განახლება ვერ მოხერხდა. სკანები რიგში ინახება.",
  "scanner.task_unavailable": "დავალება ამჟამად მიღებას არ იღებს ან სხვა შემსრულებელს აქვს. შენახული სკანები არ დაიკარგება.",
  "scanner.protected": "დაცული შიდა სისტემა — საჭიროა ავტორიზაცია",
  "scanner.logout": "გასვლა",
  "scanner.logging_out": "გასვლა…",
  "scanning.review_recorded": "ჩაიწერა, საჭიროებს ადმინის განხილვას",
  "scanning.needs_review": "საჭიროებს განხილვას",
  "scanning.no_review_needed": "განხილვა არ სჭირდება",
  "scanning.review": "მიღების განხილვა",
  "scanning.review.UNKNOWN_INTERNAL_LABEL": "უცნობი შიდა ეტიკეტი",
  "scanning.review.ARCHIVED_INTERNAL_LABEL": "არქივირებული პროდუქტის ეტიკეტი",
  "scanning.review.IDENTIFIER_COLLISION": "კოდი რამდენიმე პროდუქტს ემთხვევა",
  "scanning.review.TASK_NOT_ACCEPTING": "დავალება მიღებას აღარ იღებს",
  "scanning.review.TASK_NOT_ASSIGNED": "დავალება სხვა შემსრულებელს აქვს",
  "scanning.review_link": "არსებულ პროდუქტთან დაკავშირება",
  "scanning.review_accept": "დავალებაში მიღება",
  "scanning.review_dismiss": "განხილვის დახურვა მიღების გარეშე",
  "scanning.review_resolution": "გადაწყვეტილება",
  "scanning.review_note": "მიზეზი ან შენიშვნა",
  "scanning.review_reopen": "დავალება ხელახლა გაიხსნას",
  "scanning.review_replacement": "შეიქმნას ჩანაცვლებითი შიდა ეტიკეტი",
  "scanning.review_save": "გადაწყვეტილების შენახვა",
  "scanning.review_closed": "განხილვა დასრულებულია",
  "scanning.original_code": "სკანირებული კოდი",
  "scanning.device": "მოწყობილობა",
  "scanning.task": "დავალება",
  "scanning.archived_reference": "ძველი პროდუქტის ჩანაწერი",
  "scanning.blocked_entries": "დაბლოკილი სკანები",
  "scanning.blocked_owner": "სკანი სხვა მომხმარებლის ანგარიშს ეკუთვნის.",
  "scanning.blocked_device": "მოწყობილობა სკანის თავდაპირველ მოწყობილობას არ ემთხვევა.",
  "scanning.discard": "ჩანაწერის გაუქმება",
  "scanning.discard_reason": "გაუქმების მიზეზი",
  "scanning.discard_confirm": "გააუქმოთ ეს სკანი? გაუქმების კვალი სერვერს გაეგზავნება ინტერნეტის დაბრუნების შემდეგ.",
  "scanning.discard_reports_pending": "გასაგზავნი გაუქმების კვალი",
  "scanning.pending": "გასაგზავნი სკანები",
  "scanning.waiting_for": "{name}-ის რიგში დარჩენილია {count} სკანი. გაიგზავნება მისი ანგარიშით შესვლის შემდეგ.",
  "scanning.needs_attention": "სკანები საჭიროებს შემოწმებას",
  "scanning.retry": "გაგზავნის ხელახლა ცდა",
  "scanning.storage_error": "სკანი ვერ შეინახა მოწყობილობამ. შეამოწმეთ ბრაუზერის საცავი და სცადეთ ხელახლა.",
  "scanning.session_changed": "აქტიური მომხმარებელი შეიცვალა ან სესია დასრულდა. განაახლეთ გვერდი.",
  "scanning.refresh": "გვერდის განახლება",
  "scanning.tasks": "მიღების დავალებები",
  "scanning.intakes": "მიღებების ისტორია",
  "scanning.quick_scan": "სწრაფი სკანირება",
  "scanning.create_task": "დავალების შექმნა",
  "scanning.title": "დავალების სათაური",
  "scanning.assignee": "შემსრულებელი",
  "scanning.product_type": "პროდუქტის ტიპი",
  "scanning.target": "სამიზნე რაოდენობა",
  "scanning.due": "ვადა — თბილისის დროით",
  "scanning.progress": "პროგრესი",
  "scanning.status": "მდგომარეობა",
  "scanning.task.OPEN": "ღია",
  "scanning.task.IN_PROGRESS": "მიმდინარეობს",
  "scanning.task.COMPLETED": "დასრულებულია",
  "scanning.task.CANCELLED": "გაუქმებულია",
  "scanning.role.ADMIN": "ადმინისტრატორი",
  "scanning.role.OPERATOR": "ოპერატორი",
  "scanning.role.STOCK_MANAGER": "მარაგების მენეჯერი",
  "scanning.role.WAREHOUSE": "საწყობის თანამშრომელი",
  "scanning.role.ORDER_MANAGER": "შეკვეთების მენეჯერი",
  "scanning.all": "ყველა",
  "scanning.unset": "არ არის მითითებული",
  "scanning.result": "შედეგი",
  "scanning.result.MATCHED_EXISTING": "მოიძებნა არსებული SKU",
  "scanning.result.NEW_DRAFT": "შეიქმნა მონახაზი",
  "scanning.result.MANUAL_IDENTIFICATION_REQUIRED": "საჭიროა ხელით იდენტიფიკაცია",
  "scanning.result.PROCESSING": "მუშავდება",
  "scanning.label.NOT_REQUIRED": "არ არის საჭირო",
  "scanning.label.TO_PRINT": "დასაბეჭდია",
  "scanning.label.PRINTED": "დაბეჭდილია",
  "scanning.label.ATTACHED": "მიმაგრებულია",
  "scanning.label_status": "ეტიკეტი",
  "scanning.scanner": "შემსრულებელი",
  "scanning.duplicate": "დუბლიკატი",
  "scanning.filter": "გაფილტვრა",
  "scanning.previous": "წინა გვერდი",
  "scanning.next": "შემდეგი გვერდი",
  "scanning.code": "შტრიხკოდი ან შიდა ეტიკეტის კოდი",
  "scanning.accept": "კოდის მიღება",
  "scanning.no_barcode": "შტრიხკოდი არ აქვს",
  "scanning.photos_pending": "ფოტოები გადასაღებია",
  "scanning.available_from": "ხელმისაწვდომი იქნება M{milestone}-დან.",
  "scanning.labels": "დასაბეჭდი ეტიკეტები",
  "scanning.select": "არჩევა",
  "scanning.sku": "შიდა კოდი",
  "scanning.product": "პროდუქტი",
  "scanning.date": "თარიღი",
  "scanning.empty": "ჩანაწერები არ არის.",
  "scanning.print_selected": "არჩეული ეტიკეტების ბეჭდვა",
  "scanning.print": "ბეჭდვა — 58 × 40 მმ",
  "scanning.mark_printed": "დაბეჭდილია — დადასტურება",
  "scanning.print_help": "დაბეჭდეთ ეტიკეტები და შედეგის შემოწმების შემდეგ დაადასტურეთ. მიმაგრება პროდუქტის ეტიკეტის სკანირებით დასტურდება.",
  "scanning.back": "უკან დაბრუნება",
  "scanning.saving": "ინახება…",
  "scanning.error": "მოქმედება ვერ შესრულდა. სცადეთ ხელახლა.",
  "scanning.error.UNAUTHORIZED": "სესია დასრულდა. შედით თავიდან.",
  "scanning.error.FORBIDDEN": "ამ მოქმედების უფლება არ გაქვთ.",
  "scanning.error.NOT_FOUND": "ჩანაწერი ვერ მოიძებნა.",
  "scanning.error.VALIDATION_ERROR": "შეამოწმეთ შეყვანილი მონაცემები.",
  "scanning.error.CONFLICT": "მონაცემები შეიცვალა. განაახლეთ გვერდი.",
  "scanning.error.IDEMPOTENCY_CONFLICT": "მოთხოვნის კოდი სხვა მონაცემებით უკვე გამოყენებულია.",
  "scanning.error.PRECONDITION_FAILED": "ჩანაწერის მიმდინარე მდგომარეობა ამ მოქმედებას არ უშვებს.",
  "scanning.error.INVARIANT_VIOLATION": "მონაცემების შენახვა ვერ მოხერხდა."
} as const;

export const DICTIONARY = {
  ka: {
    ...SCANNING_LABELS,
    "app.title": "Khidi — სასაწყობო და კატალოგის ჰაბი",
    "app.subtitle": "კანონიკური პროდუქტების, მარაგების, ფასებისა და შესრულების ცენტრი",
    "auth.office_login": "ოფისის შესვლა (ელ-ფოსტა + TOTP)",
    "auth.warehouse_pin": "საწყობის სწრაფი შესვლა (PIN)",
    "auth.logout": "გასვლა",
    "warehouse.scan_accepted": "✓ კოდი მიღებულია",
    "warehouse.next_scan": "შემდეგი პროდუქტის სკანირება",
    "warehouse.photo_blurry": "⚠ ფოტო ბუნდოვანია, გადაიღეთ თავიდან",
    "warehouse.offline_pending": "ოფლაინ რიგშია სინქრონიზაციისთვის",
    "settings.operating_model_title": "ონლაინ საწყობის ოპერაციული მოდელი (§10.1, C1, C13)",
    "settings.operating_model_rule1": "1. ბუღალტერიაში იქმნება გამოყოფილი ონლაინ საწყობი/ლოკაცია, სადაც შიდა გადაადგილებით გადადის ონლაინ გასაყიდი მარაგი.",
    "settings.operating_model_rule2": "2. თითოეული პულის SHELF (თარო) და STAGING (აგროვებული შეკვეთების ზონა) ფიზიკურად მარკირებულია, რათა პერსონალმა მკაფიოდ გაარჩიოს მფლობელი იურიდიული პირები (PURCHASE რეჟიმში) [C13].",
    "settings.operating_model_rule3": "3. გადაცემის (HANDED_OVER) შემდეგ დაბრუნებული პროდუქცია მიდის მხოლოდ მთავარ საწყობში და არასდროს ბრუნდება პირდაპირ ონლაინ თაროზე. ხელახალი ონლაინ გაყიდვისთვის საჭიროა ახალი STOCK_IN დოკუმენტის ნომრით [C1]."
  },
  en: {
    ...SCANNING_LABELS,
    "app.title": "Khidi — Online Warehouse & Catalog Hub",
    "app.subtitle": "Canonical Product Master, Inventory, Pricing & Fulfillment Hub",
    "auth.office_login": "Office Login (Email + TOTP)",
    "auth.warehouse_pin": "Warehouse Quick Switch (PIN)",
    "auth.logout": "Sign out",
    "warehouse.scan_accepted": "✓ კოდი მიღებულია",
    "warehouse.next_scan": "შემდეგი პროდუქტის სკანირება",
    "warehouse.photo_blurry": "⚠ ფოტო ბუნდოვანია, გადაიღეთ თავიდან",
    "warehouse.offline_pending": "Pending offline sync",
    "settings.operating_model_title": "Online Warehouse Operating Model (§10.1, C1, C13)",
    "settings.operating_model_rule1": "1. A dedicated online warehouse is maintained in accounting and online units are transferred there.",
    "settings.operating_model_rule2": "2. Each pool's SHELF and STAGING zones are physically marked so staff can distinguish legal entity owners [C13].",
    "settings.operating_model_rule3": "3. Returned goods after HANDED_OVER go to the main warehouse, never directly back to the online shelf without a new STOCK_IN document reference [C1]."
  }
} as const;

export type TranslationKey = keyof typeof DICTIONARY.ka;

export function t(key: TranslationKey, locale: SupportedLocale = "ka", isWarehouseUi = false): string {
  // Warehouse UI is always Georgian (§13.5)
  const effectiveLocale: SupportedLocale = isWarehouseUi ? "ka" : locale;
  return DICTIONARY[effectiveLocale][key] ?? DICTIONARY.ka[key];
}
