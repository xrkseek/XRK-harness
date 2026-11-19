/**
 * Remote phone_* schemas — mirror PhoneToolCatalog (Android).
 * Keep names/descriptions stable; drift breaks model KV cache.
 */
const str = (description) => ({ type: "string", description });
const bool = (description) => ({ type: "boolean", description });
const int = (description) => ({ type: "integer", description });
const num = (description) => ({ type: "number", description });
const en = (values, description) => ({ type: "string", enum: values, description });

const SCREEN_ID = str("屏幕号，如 s7（主屏）或 b3（后台屏），取自最近一次返回的屏幕");
const INTENT_KINDS = [
  "alarm",
  "timer",
  "calendar",
  "dial",
  "sms_draft",
  "share",
  "navigate",
  "settings",
];
const SETTINGS_PAGES = [
  "home",
  "wifi",
  "bluetooth",
  "mobile_network",
  "airplane",
  "display",
  "sound",
  "battery",
  "location",
  "date",
  "language",
  "storage",
  "nfc",
  "app_notifications",
];
const KEYS = ["back", "home", "recents", "notifications"];
const DIRECTIONS = ["up", "down", "left", "right"];
const NAV_MODES = ["drive", "transit", "walk", "ride"];

function tool(name, description, properties, required = []) {
  const inputSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) inputSchema.required = required;
  return { name, description, inputSchema };
}

/** @type {readonly { name: string, description: string, inputSchema: object }[]} */
export const PHONE_TOOL_CATALOG = [
  tool(
    "apps",
    "列出这台手机上能打开的应用（名称 · 包名）。query 可用中文名或包名；先 apps 再 open，拿返回的包名最稳。",
    { query: str("按名称（含中文）或包名筛选，可省略") },
  ),
  tool(
    "open",
    "尝试打开应用或链接（app 或 url 二选一）。app 优先用包名（如 com.taobao.taobao）；中文应用名也可，找不到就先 phone_apps。background:true 仅用于在后台屏打开应用（需用户开通不打扰模式）；可读取时返回新屏幕。启动回话不表示目标业务已经完成。",
    {
      app: str("包名优先；也可用中文/英文应用名"),
      url: str("网址或深链"),
      background: bool("在后台屏打开"),
    },
  ),
  tool(
    "intent",
    "用系统意图把事务交给处理应用，能办就别点界面；后续界面和确认由该应用决定，启动回话不证明事务完成。字段按 kind：" +
      "alarm(hour,minute,days?,message?)、timer(seconds,message?)、calendar(title,begin,end?,all_day?,location?,description?)、" +
      "dial(number)、sms_draft(number?,text)、share(text,app?)、navigate(destination|lat+lng,mode?,map?)、settings(page,app?)。",
    {
      kind: en(INTENT_KINDS, "事务类型"),
      hour: int("时 0–23"),
      minute: int("分 0–59"),
      days: {
        type: "array",
        items: { type: "integer" },
        description: "重复的星期，1=周一 … 7=周日；省略只响一次",
      },
      seconds: int("秒 1–86400"),
      message: str("闹钟 / 计时器标签"),
      title: str("日程标题"),
      begin: str("开始，如 2026-10-24T19:00（手机时区）；全天写 2026-10-24"),
      end: str("结束，省略 = 开始后 1 小时"),
      all_day: bool("全天"),
      location: str("地点"),
      description: str("备注"),
      number: str("电话号码"),
      text: str("文字内容"),
      app: str("分享目标应用（省略弹分享面板）；settings:app_notifications 用哪个应用"),
      destination: str("目的地名称或地址"),
      lat: num("纬度 GCJ-02"),
      lng: num("经度 GCJ-02"),
      mode: en(NAV_MODES, "出行方式，默认 drive"),
      map: en(["amap", "baidu"], "地图，默认先高德再百度"),
      page: en(SETTINGS_PAGES, "设置页；app_notifications 还需 app"),
    },
    ["kind"],
  ),
  tool(
    "notify",
    "给用户发一条手机通知。",
    { title: str("标题"), text: str("正文") },
    ["title", "text"],
  ),
  tool(
    "clipboard",
    "读写剪贴板：set 写入文字；get:true 读取（系统只允许前台应用读，XRK 不在前台时读不到）。",
    { set: str("要写入的文字"), get: bool("读取剪贴板") },
  ),
  tool(
    "screen",
    "读当前屏幕：每行一个元素，[编号] 只在本屏有效。detail:true 附坐标，结果可能截断；image:true 请求截图，安全或能力限制时可能不附图（主屏可带编号，后台图不带编号）；background:true 读后台屏。元素少或为空不表示页面安全；本机文字识别不可用时按回话提示处理，无法核对目标就 handoff。",
    {
      detail: bool("附上已返回元素的坐标，不保证完整页面"),
      image: bool("请求附带截图；可能因安全或能力限制省略"),
      background: bool("读后台屏（不打扰模式）"),
    },
  ),
  tool(
    "collect",
    "只读：自动滚动列表收集全部条目（按文字去重），读长列表只用这一次。",
    {
      screen: SCREEN_ID,
      list: int("列表的编号"),
      max_pages: int("最多翻几页（1–30），默认 10"),
      until: str("出现这段文字就停"),
    },
    ["screen", "list"],
  ),
  tool(
    "tap",
    "点一个元素，返回新屏幕。敏感按钮或首次操作该 App 会先请用户确认。",
    { screen: SCREEN_ID, id: int("元素编号"), long: bool("长按") },
    ["screen", "id"],
  ),
  tool(
    "type",
    "在输入框输入文字（替换原内容），返回回读和新屏幕。submit:true 后按回车 / 发送，要确认。密码、验证码、支付框默认拒绝，被拒绝就 handoff。",
    {
      screen: SCREEN_ID,
      id: int("输入框编号"),
      text: str("要输入的文字"),
      submit: bool("输入后提交 / 发送"),
    },
    ["screen", "id", "text"],
  ),
  tool(
    "scroll",
    "滚动，返回新屏幕。id 是要滚动的列表，省略时滚主列表。",
    {
      screen: SCREEN_ID,
      id: int("列表编号，可省略"),
      direction: en(DIRECTIONS, "方向"),
    },
    ["screen", "direction"],
  ),
  tool(
    "key",
    "按系统键（back / home / recents / notifications），返回新屏幕。",
    { key: en(KEYS, "按键"), screen: str("屏幕号；省略时作用于主屏") },
    ["key"],
  ),
  tool(
    "tap_xy",
    "按本任务最近一次实际返回截图的像素坐标操作，只在元素里找不到目标时用。action 默认为 tap；long 长按；swipe 从 (x,y) 滑到 (x2,y2)。主屏用 s 号、后台屏用 b 号；截图超过 30 秒或上下文核对失败要重读。每张图只供一次坐标手势；需通过安全检查与所需用户确认，长按和滑动仍逐次确认。结果可报告画面变化，但不表示目标业务成功；结果未知或未变化先读屏，不自动重试。",
    {
      observation: str("本任务最近一次实际返回截图的屏幕号（主屏 s 号或后台屏 b 号）"),
      x: int("横坐标（像素，从 0 开始）"),
      y: int("纵坐标（像素，从 0 开始）"),
      action: en(["tap", "long", "swipe"], "操作类型，省略为 tap；long 为长按，swipe 为滑动"),
      x2: int("仅 swipe：终点横坐标（原截图像素，非负整数）"),
      y2: int("仅 swipe：终点纵坐标（原截图像素，非负整数）"),
      duration_ms: int("仅 swipe：时长 100–2000 毫秒，省略为 400"),
    },
    ["observation", "x", "y"],
  ),
  tool(
    "handoff",
    "把手机交给用户完成登录、验证码、支付或没把握的步骤；等用户点「继续」或「停止」，最长 10 分钟。",
    { reason: str("要用户做什么，一句话") },
    ["reason"],
  ),
];
