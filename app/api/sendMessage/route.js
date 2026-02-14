import { NextResponse } from "next/server";

// ---------- 环境变量 ----------
const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK || "https://oapi.dingtalk.com/robot/send?access_token=你的token";
const RELAY_SERVICE_URL = process.env.RELAY_SERVICE_URL || "https://send-todingtalk-pnvjfgztkw.cn-hangzhou.fcapp.run";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const USE_RELAY_SERVICE = process.env.USE_RELAY_SERVICE === "true";
const SEND_TO_DISCORD = process.env.SEND_TO_DISCORD === "true";
const DEFAULT_CAPITAL = parseFloat(process.env.DEFAULT_CAPITAL || "1000");
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || "https://aa44444.vercel.app";

// 用于临时存储开仓价格（按交易对）
const lastEntryBySymbol = Object.create(null);

// ---------- 辅助解析函数 ----------
function getNum(text, key) {
  const re = new RegExp(`${key}\\s*[:：]\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const m = String(text).match(re);
  return m ? parseFloat(m[1]) : null;
}

function getStr(text, key) {
  const re = new RegExp(`${key}\\s*[:：]\\s*([^,\\n]+)`);
  const m = String(text).match(re);
  return m ? m[1].trim() : null;
}

function getSymbol(text) {
  const symbol = getStr(text, "品种");
  return symbol ? symbol.split(' ')[0].replace(/[^a-zA-Z0-9.]/g, '') : null;
}

function getDirection(text) {
  const dir = getStr(text, "方向");
  if (!dir) return null;
  if (dir.includes("多") || dir.includes("buy") || dir.includes("Buy") || dir === "买") return "买";
  if (dir.includes("空") || dir.includes("sell") || dir.includes("Sell") || dir === "卖") return "卖";
  return null;
}

function getLatestPrice(text) {
  return getNum(text, "最新价格") || getNum(text, "当前价格") || getNum(text, "市价");
}

// ---------- 格式化价格（保留原始精度，最多5位）----------
function formatPriceSmart(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || "-";
  }
  const strValue = value.toString();
  const decimalIndex = strValue.indexOf('.');
  if (decimalIndex === -1) return strValue;
  const decimalPart = strValue.substring(decimalIndex + 1);
  const decimalLength = decimalPart.length;
  if (decimalLength > 5) return value.toFixed(5);
  return strValue;
}

// ---------- 消息类型判断（严格模式）----------
function isTP2(t) { return /(?:^|\n)TP2达成/.test(t); }
function isTP1(t) { return /(?:^|\n)TP1达成/.test(t); }
function isBreakeven(t) { return /(?:^|\n)已到保本位置/.test(t); }
function isBreakevenStop(t) { return /保本止损.*触发/.test(t); }
function isInitialStop(t) { return /初始止损.*触发/.test(t); }
function isEntry(t) {
  return /【开仓】/.test(t) || (/开仓价格/.test(t) && !isTP1(t) && !isTP2(t) && !isBreakeven(t) && !isBreakevenStop(t) && !isInitialStop(t));
}

function getMessageType(text) {
  if (isTP2(text)) return "TP2";
  if (isTP1(text)) return "TP1";
  if (isBreakeven(text)) return "BREAKEVEN";
  if (isBreakevenStop(text)) return "BREAKEVEN_STOP";
  if (isInitialStop(text)) return "INITIAL_STOP";
  if (isEntry(text)) return "ENTRY";
  return "OTHER";
}

// ---------- 图片价格获取函数（经过验证）----------
function getImagePrice(rawData, entryPrice) {
  console.log("=== getImagePrice 详细调试 ===");
  console.log("原始数据:", rawData);
  const latestPrice = getLatestPrice(rawData);
  console.log("- 最新价格:", latestPrice);
  const closingPrice = getNum(rawData, "平仓价格");
  console.log("- 平仓价格:", closingPrice);
  let triggerPrice = null;
  if (isTP1(rawData)) {
    triggerPrice = getNum(rawData, "TP1价格") || getNum(rawData, "TP1") || closingPrice;
    console.log("- TP1触发价格:", triggerPrice);
  } else if (isTP2(rawData)) {
    triggerPrice = getNum(rawData, "TP2价格") || getNum(rawData, "TP2") || closingPrice;
    console.log("- TP2触发价格:", triggerPrice);
  } else if (isBreakeven(rawData)) {
    triggerPrice = closingPrice || getNum(rawData, "触发价格") || getNum(rawData, "保本位") || getNum(rawData, "移动止损到保本位");
    console.log("- 保本触发价格:", triggerPrice);
    if (!triggerPrice) {
      const priceMatch = rawData.match(/(?:平仓价格|触发价格|保本位|移动止损到保本位)\s*[:：]\s*(\d+(?:\.\d+)?)/);
      if (priceMatch) {
        triggerPrice = parseFloat(priceMatch[1]);
        console.log("- 从文本提取的触发价格:", triggerPrice);
      }
    }
  }
  console.log("- 开仓价格:", entryPrice);
  let finalPrice;
  if (closingPrice) {
    finalPrice = closingPrice;
    console.log("- 使用平仓价格作为最终价格");
  } else {
    if (isBreakeven(rawData)) {
      finalPrice = triggerPrice || latestPrice || entryPrice;
    } else {
      finalPrice = latestPrice || triggerPrice || entryPrice;
    }
  }
  console.log("- 最终选择的价格:", finalPrice);
  console.log("=== getImagePrice 调试结束 ===");
  return finalPrice;
}

// ---------- 构建图片 URL（旧链路，无后缀）----------
function generateImageURL(params) {
  const { symbol, direction, entry, price, capital = DEFAULT_CAPITAL } = params;
  const url = new URL(`${IMAGE_BASE_URL}/api/card-image`);
  url.searchParams.set('symbol', symbol || 'SOLUSDT.P');
  url.searchParams.set('direction', direction === '卖' ? '卖' : '买');
  url.searchParams.set('entry', formatPriceSmart(entry));
  url.searchParams.set('price', formatPriceSmart(price));
  url.searchParams.set('capital', capital.toString());
  return url.toString();
}

// ---------- 精简版消息格式化（无头部、无时间戳、无盈利百分比）----------
function formatForDingTalk(raw) {
  const text = String(raw || "").replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();

  const symbol = getSymbol(text) || "SYMBOL";
  const direction = getDirection(text) || "买";
  const symbolLine = `${symbol} ｜ ${direction === '卖' ? '空頭' : '多頭'}`;

  const entryPrice = getNum(text, "开仓价格");
  const stopPrice = getNum(text, "止损价格");
  const breakevenPrice = getNum(text, "保本位");
  const tp1Price = getNum(text, "TP1");
  const tp2Price = getNum(text, "TP2");
  const triggerPrice = getNum(text, "触发价格") || getNum(text, "平仓价格");

  if (isEntry(text) && symbol && entryPrice != null) {
    lastEntryBySymbol[symbol] = { entry: entryPrice, t: Date.now() };
  }

  let body = "";
  if (isEntry(text)) {
    body =
      `⚡ 系統啟動\n` +
      `${symbolLine}\n\n` +
      `入場：${formatPriceSmart(entryPrice)}\n` +
      `風險：${formatPriceSmart(stopPrice)}\n` +
      `保護：${formatPriceSmart(breakevenPrice)}\n\n` +
      `階段一：${formatPriceSmart(tp1Price)}\n` +
      `階段二：${formatPriceSmart(tp2Price)}\n\n` +
      `狀態：持倉`;
  } else if (isBreakeven(text)) {
    body =
      `⚡ 倉位更新\n` +
      `${symbolLine}\n\n` +
      `保護位生效\n` +
      `風險轉移完成\n\n` +
      `保護：${formatPriceSmart(breakevenPrice || triggerPrice)}\n\n` +
      `狀態：已保護`;
  } else if (isTP1(text)) {
    body =
      `⚡ 階段推進\n` +
      `${symbolLine}\n\n` +
      `階段一完成\n` +
      `結構延伸中\n\n` +
      `狀態：持續持倉`;
  } else if (isTP2(text)) {
    body =
      `⚡ 階段完成\n` +
      `${symbolLine}\n\n` +
      `階段二完成\n` +
      `本輪結構結束\n\n` +
      `狀態：週期重置`;
  } else if (isBreakevenStop(text)) {
    body =
      `⚡ 倉位關閉\n` +
      `${symbolLine}\n\n` +
      `保護觸發\n` +
      `倉位平倉\n\n` +
      `風險已完全轉移\n\n` +
      `狀態：重置`;
  } else if (isInitialStop(text)) {
    body =
      `⚡ 週期關閉\n` +
      `${symbolLine}\n\n` +
      `風險觸發\n` +
      `倉位關閉\n\n` +
      `狀態：重置`;
  } else {
    body = text.replace(/,\s*/g, "\n").replace(/\\n/g, "\n");
  }
  return body;
}

// ---------- 发送到 Discord（纯 embed 模式，文本 + 图片，无彩色）----------
async function sendToDiscord(messageData, imageUrl = null) {
  if (!SEND_TO_DISCORD || !DISCORD_WEBHOOK_URL) {
    console.log("Discord发送未启用或Webhook未配置，跳过");
    return { success: true, skipped: true };
  }

  try {
    console.log("=== 开始发送到Discord（纯 embed 模式） ===");
    
    const embed = {
      title: "\u200B",                // 零宽空格，不可见
      description: messageData,       // 精简文本
      color: null,                    // 无色
      timestamp: new Date().toISOString(),
      footer: { text: "\u200B" },     // 零宽空格
    };

    if (imageUrl) {
      embed.image = { url: imageUrl };
    }

    const discordPayload = {
      embeds: [embed]                  // 只发送 embed，无 content
    };

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Discord响应错误:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log("Discord消息发送成功");
    return { success: true };
  } catch (error) {
    console.error("Discord发送失败:", error);
    return { success: false, error: error.message, skipped: false };
  }
}

// ---------- POST 入口 ----------
export async function POST(req) {
  try {
    console.log("=== 收到TradingView Webhook请求 ===");
    const contentType = req.headers.get("content-type") || "";
    let raw;

    if (contentType.includes("application/json")) {
      const json = await req.json();
      raw = typeof json === "string" ? json : json?.message || json?.text || json?.content || JSON.stringify(json);
    } else {
      raw = await req.text();
    }

    const processedRaw = String(raw).replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();

    if (!processedRaw || !/(品种|方向|开仓|止损|TP1|TP2|保本|盈利|胜率|交易次数)/.test(processedRaw)) {
      console.log("无效或空白消息，跳过");
      return NextResponse.json({ ok: true, skipped: true, reason: "无效或空白消息" });
    }

    const formattedMessage = formatForDingTalk(processedRaw);
    const messageType = getMessageType(processedRaw);
    console.log("消息类型:", messageType);
    console.log("格式化消息预览:\n", formattedMessage);

    // 生成图片（仅保本/TP1/TP2）
    let imageUrl = null;
    if (isBreakeven(processedRaw) || isTP1(processedRaw) || isTP2(processedRaw)) {
      const symbol = getSymbol(processedRaw) || "SYMBOL";
      const direction = getDirection(processedRaw) || "买";
      const entry = getNum(processedRaw, "开仓价格") || (symbol && lastEntryBySymbol[symbol]?.entry) || null;
      const price = getImagePrice(processedRaw, entry);

      if (price !== null && !isNaN(price) && price !== '-') {
        imageUrl = generateImageURL({
          symbol,
          direction,
          entry,
          price,
          capital: DEFAULT_CAPITAL,
        });
        console.log("生成的图片URL:", imageUrl);
      } else {
        console.log("无法获取有效价格，跳过图片生成");
      }
    }

    // 并行发送（钉钉、Discord）
    const [dingtalkResult, discordResult] = await Promise.allSettled([
      // 钉钉发送
      (async () => {
        let finalMessage = formattedMessage;
        if (imageUrl) {
          finalMessage += `\n\n![交易图表](${imageUrl})`;
        }
        if (USE_RELAY_SERVICE) {
          const relayPayload = {
            message: finalMessage,
            needImage: false,
            imageParams: null,
            dingtalkWebhook: DINGTALK_WEBHOOK,
          };
          const resp = await fetch(RELAY_SERVICE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(relayPayload)
          });
          const data = await resp.json();
          if (!data.success) throw new Error(data.error);
          return { ok: true, relayData: data };
        } else {
          const markdown = {
            msgtype: "markdown",
            markdown: { title: "交易通知", text: finalMessage },
            at: { isAtAll: false }
          };
          const resp = await fetch(DINGTALK_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(markdown)
          });
          const data = await resp.json().catch(() => ({}));
          return { ok: true, dingTalk: data };
        }
      })(),

      // Discord 发送（纯 embed）
      sendToDiscord(formattedMessage, imageUrl)
    ]);

    const results = {
      dingtalk: dingtalkResult.status === 'fulfilled' ? dingtalkResult.value : { error: dingtalkResult.reason?.message },
      discord: discordResult.status === 'fulfilled' ? discordResult.value : { error: discordResult.reason?.message }
    };

    console.log("最终发送结果:", results);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    console.error("处理请求时发生错误:", e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

// ---------- GET 健康检查 ----------
export const dynamic = 'force-dynamic';
export async function GET() {
  return new Response(JSON.stringify({ message: 'TradingView Webhook API is running', timestamp: new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
