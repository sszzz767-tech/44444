// /app/api/card-image/route.js
// 终极稳定版 —— 使用 next/font 加载 Geist 字体
import { ImageResponse } from '@vercel/og';
// 从 geist 包中加载字重为 900 的 Geist Sans 字体
import { GeistSans } from 'geist/font';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

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
        const BACKGROUND_IMAGE_URL = 'https://res.cloudinary.com/dtbc3aa1o/image/upload/v1770971863/%E6%96%B0%E5%BA%95%E5%9B%BE_eoyhgf.png';

        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get('symbol') || 'SOLUSDT.P';
        const direction = searchParams.get('direction') || '买';
        const entry = searchParams.get('entry');
        const price = searchParams.get('price');
        const timeParam = searchParams.get('time');
        const capital = parseFloat(searchParams.get('capital') || process.env.DEFAULT_CAPITAL || '1000');
        const leverage = 30;

        const displaySymbol = symbol.replace('.P', '').replace('.p', '') + ' 永续';
        const displayDirection = (direction === '空头' || direction === '卖' || direction === '賣' || direction === '空') ? '卖' : '买';
        const displayEntry = formatPriceSmart(entry || '-');
        const displayPrice = formatPriceSmart(price || entry || '-');
        const displayTime = timeParam || getBeijingTime();

        let profitAmount = null;
        if (entry && price) {
            profitAmount = calculateProfit(entry, price, direction, capital, leverage);
        }
        const displayProfit = profitAmount !== null && !isNaN(profitAmount) 
            ? `${profitAmount > 0 ? '+' : ''}${profitAmount.toFixed(2)}` 
            : '+0.00';

        // **** 使用 next/font 加载的 Geist 字体 ****
        // GeistSans.style.fontFamily 会返回类似 'Geist Sans' 的字体名称
        // GeistSans.style.fontWeight 已经包含了 900 字重

        return new ImageResponse(
            (
                <div
                    style={{
                        display: 'flex',
                        width: '950px',
                        height: '1300px',
                        backgroundImage: `url(${BACKGROUND_IMAGE_URL})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        position: 'relative',
                        // 直接使用 GeistSans 的字体家族
                        fontFamily: GeistSans.style.fontFamily,
                        // fontWeight 已在字体文件中定义，无需重复设置
                    }}
                >
                    {/* 右上角：时间 */}
                    <div style={{
                        position: 'absolute',
                        right: '445px',
                        top: '145px',
                        fontSize: '33px',
                        fontWeight: '800',
                        color: '#ffffff',
                        letterSpacing: '0.5px',
                    }}>
                        {displayTime}
                    </div>

                    {/* 交易对 */}
                    <div style={{
                        position: 'absolute',
                        left: '50px',
                        top: '395px',
                        fontSize: '47px',
                        fontWeight: '900',
                        color: '#ffffff',
                    }}>
                        {displaySymbol}
                    </div>

                    {/* 方向 */}
                    <div style={{
                        position: 'absolute',
                        left: '53px',
                        top: '470px',
                        fontSize: '35px',
                        fontWeight: '900',
                        color: displayDirection === '卖' ? '#cc3333' : '#00aa5e',
                    }}>
                        {displayDirection}
                    </div>

                    {/* 盈利金额 */}
                    <div style={{
                        position: 'absolute',
                        left: '55px',
                        top: '585px',
                        fontSize: '90px',
                        fontWeight: '900',
                        color: profitAmount >= 0 ? '#00aa5e' : '#cc3333',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                    }}>
                        <span>{displayProfit}</span>
                    </div>

                    {/* 开仓价格 */}
                    <div style={{
                        position: 'absolute',
                        left: '60px',
                        bottom: '430px',
                        fontSize: '35px',
                        fontWeight: '900',
                        color: '#ffffff',
                    }}>
                        {displayEntry}
                    </div>

                    {/* 最新价格 */}
                    <div style={{
                        position: 'absolute',
                        left: '505px',
                        bottom: '430px',
                        fontSize: '35px',
                        fontWeight: '900',
                        color: '#ffffff',
                    }}>
                        {displayPrice}
                    </div>
                </div>
            ),
            {
                width: 950,
                height: 1300,
                // 无需手动传递 fonts 数组，因为 GeistSans 的样式已通过 CSS 方式注入
                // @vercel/og 会自动识别从 next/font 导入的字体
                headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
            }
        );
    } catch (error) {
        console.error('图片生成失败:', error);
        return new Response(JSON.stringify({ error: '图片生成失败', message: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
