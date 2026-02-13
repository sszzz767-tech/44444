// /app/api/card-image/route.js
// 独立图片生成路由 —— 专用于你的新底图，无本地字体依赖
import { ImageResponse } from '@vercel/og';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// ---------- 智能价格格式化（保留原始精度，最多5位）----------
function formatPriceSmart(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || '-';
    }
    const strValue = value.toString();
    const decimalIndex = strValue.indexOf('.');
    if (decimalIndex === -1) return strValue;
    const decimalPart = strValue.substring(decimalIndex + 1);
    const decimalLength = decimalPart.length;
    if (decimalLength > 5) return value.toFixed(5);
    return strValue;
}

// ---------- 盈利金额计算（真实价差，无随机）----------
function calculateProfit(entry, current, direction, capital = 1000, leverage = 30) {
    if (!entry || !current) return null;
    const entryNum = parseFloat(entry);
    const currentNum = parseFloat(current);
    if (isNaN(entryNum) || isNaN(currentNum)) return null;

    let priceDiff;
    if (direction === '买' || direction === '多头' || direction === '多頭') {
        priceDiff = currentNum - entryNum;
    } else {
        priceDiff = entryNum - currentNum;
    }

    const profitAmount = capital * leverage * (priceDiff / entryNum);
    return profitAmount;
}

// ---------- 北京时间格式化----------
function getBeijingTime() {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export async function GET(request) {
    try {
        // 1. 固定背景图 URL（你指定的新底图）
        const BACKGROUND_IMAGE_URL = 'https://res.cloudinary.com/dtbc3aa1o/image/upload/v1770971863/%E6%96%B0%E5%BA%95%E5%9B%BE_eoyhgf.png';

        // 2. 获取查询参数
        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get('symbol') || 'SOLUSDT.P';
        const direction = searchParams.get('direction') || '买';
        const entry = searchParams.get('entry');
        const price = searchParams.get('price');
        const timeParam = searchParams.get('time');
        const capital = parseFloat(searchParams.get('capital') || process.env.DEFAULT_CAPITAL || '1000');
        const leverage = 30; // 底图已固定30x，计算用

        // 3. 格式化显示值
        const displaySymbol = symbol.replace('.P', '').replace('.p', '') + ' 永续';
        const displayDirection = (direction === '空头' || direction === '卖' || direction === '賣' || direction === '空') ? '卖' : '买';
        const displayEntry = formatPriceSmart(entry || '-');
        const displayPrice = formatPriceSmart(price || entry || '-');
        const displayTime = timeParam || getBeijingTime();

        // 4. 计算盈利金额
        let profitAmount = null;
        if (entry && price) {
            profitAmount = calculateProfit(entry, price, direction, capital, leverage);
        }
        const displayProfit = profitAmount !== null && !isNaN(profitAmount) 
            ? `${profitAmount > 0 ? '+' : ''}${profitAmount.toFixed(2)}` 
            : '+0.00';

        // 5. 生成图片 - 不加载任何自定义字体，完全依赖系统回退字体
        return new ImageResponse(
            (
                <div
                    style={{
                        display: 'flex',
                        width: '600px',
                        height: '350px',
                        backgroundImage: `url(${BACKGROUND_IMAGE_URL})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        position: 'relative',
                        // 直接使用系统字体，无需额外加载
                        fontFamily: '"PingFang SC", "Helvetica Neue", "Microsoft YaHei", Arial, sans-serif',
                    }}
                >
                    {/* 右上角：时间 */}
                    <div style={{
                        position: 'absolute',
                        right: '45px',
                        top: '25px',
                        fontSize: '16px',
                        color: '#a0a0c0',
                        letterSpacing: '0.5px',
                    }}>
                        {displayTime}
                    </div>

                    {/* 交易对 */}
                    <div style={{
                        position: 'absolute',
                        left: '45px',
                        top: '85px',
                        fontSize: '22px',
                        fontWeight: '600',
                        color: '#ffffff',
                    }}>
                        {displaySymbol}
                    </div>

                    {/* 方向（买/卖） */}
                    <div style={{
                        position: 'absolute',
                        left: '45px',
                        top: '125px',
                        fontSize: '20px',
                        fontWeight: '600',
                        color: displayDirection === '卖' ? '#ff4757' : '#00ff88',
                    }}>
                        {displayDirection}
                    </div>

                    {/* 盈利金额（大号） */}
                    <div style={{
                        position: 'absolute',
                        left: '45px',
                        top: '170px',
                        fontSize: '48px',
                        fontWeight: '700',
                        color: profitAmount >= 0 ? '#00ff88' : '#ff4757',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                    }}>
                        <span>{displayProfit}</span>
                        {/* 单位 USDT 已印在底图上，不重复添加 */}
                    </div>

                    {/* 开仓价格（左下） */}
                    <div style={{
                        position: 'absolute',
                        left: '45px',
                        bottom: '70px',
                        fontSize: '22px',
                        fontWeight: '600',
                        color: '#b8b800',
                    }}>
                        {displayEntry}
                    </div>

                    {/* 最新价格（右下） */}
                    <div style={{
                        position: 'absolute',
                        right: '45px',
                        bottom: '70px',
                        fontSize: '22px',
                        fontWeight: '600',
                        color: '#b8b800',
                    }}>
                        {displayPrice}
                    </div>
                </div>
            ),
            {
                width: 600,
                height: 350,
                // 不再提供 fonts 数组，完全依赖 Edge 环境的系统字体
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=3600',
                },
            }
        );
    } catch (error) {
        console.error('图片生成失败:', error);
        return new Response(
            JSON.stringify({ error: '图片生成失败', message: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
