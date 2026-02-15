// /app/api/card-image/route.js
// 最终版 —— 支持英文方向参数（buy/sell）并映射为中文显示
import { ImageResponse } from '@vercel/og';

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
    // 将英文方向转换为内部判断
    const isLong = direction === 'buy' || direction === '买' || direction === '多头' || direction === '多頭';
    if (isLong) {
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
        const BACKGROUND_IMAGE_URL = 'https://res.cloudinary.com/dtbc3aa1o/image/upload/v1770995999/%E6%96%B0%E5%BA%95%E5%9B%BE1_bh9ysa.png';

        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get('symbol') || 'SOLUSDT.P';
        let direction = searchParams.get('direction') || '买';
        const entry = searchParams.get('entry');
        const price = searchParams.get('price');
        const timeParam = searchParams.get('time');
        const capital = parseFloat(searchParams.get('capital') || process.env.DEFAULT_CAPITAL || '1000');
        const leverage = 30;

        // 将英文方向参数映射为显示用的中文
        let displayDirection;
        if (direction === 'buy' || direction === '买' || direction === '多头' || direction === '多頭') {
            displayDirection = '买';
        } else {
            displayDirection = '卖';
        }

        const displaySymbol = symbol.replace('.P', '').replace('.p', '') + ' 永续';
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

        // 加载字体
        const origin = new URL(request.url).origin;
        const blackFontUrl = `${origin}/fonts/Geist-Black.ttf`;
        const regularFontUrl = `${origin}/fonts/Geist-Regular.ttf`;

        const [blackData, regularData] = await Promise.all([
            fetch(blackFontUrl).then(res => res.arrayBuffer()),
            fetch(regularFontUrl).then(res => res.arrayBuffer()),
        ]);

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
                    }}
                >
                    {/* 右上角：时间 */}
                    <div style={{
                        position: 'absolute',
                        right: '420px',
                        top: '145px',
                        fontSize: '33px',
                        fontWeight: 400,
                        fontFamily: 'Geist',
                        color: '#F0F0F0',
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
                        fontWeight: 900,
                        fontFamily: 'Geist',
                        color: '#F0F0F0',
                    }}>
                        {displaySymbol}
                    </div>

                    {/* 方向（买/卖） */}
                    <div style={{
                        position: 'absolute',
                        left: '53px',
                        top: '475px',
                        fontSize: '35px',
                        fontWeight: 900,
                        fontFamily: 'Geist',
                        color: displayDirection === '卖' ? '#cc3333' : '#35B97C',
                    }}>
                        {displayDirection}
                    </div>

                    {/* 盈利金额 + USDT */}
                    <div style={{
                        position: 'absolute',
                        left: '40px',
                        top: '585px',
                        fontSize: '85px',
                        fontWeight: 900,
                        fontFamily: 'Geist',
                        color: profitAmount >= 0 ? '#35B97C' : '#cc3333',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                    }}>
                        <span>{displayProfit}</span>
                        <span style={{
                            fontSize: '50px',
                            fontWeight: 900,
                            color: '#F0F0F0',
                            marginLeft: '5px',
                        }}>USDT</span>
                    </div>

                    {/* 开仓价格 */}
                    <div style={{
                        position: 'absolute',
                        left: '60px',
                        bottom: '430px',
                        fontSize: '35px',
                        fontWeight: 400,
                        fontFamily: 'Geist',
                        color: '#F0F0F0',
                    }}>
                        {displayEntry}
                    </div>

                    {/* 最新价格 */}
                    <div style={{
                        position: 'absolute',
                        left: '505px',
                        bottom: '430px',
                        fontSize: '35px',
                        fontWeight: 400,
                        fontFamily: 'Geist',
                        color: '#F0F0F0',
                    }}>
                        {displayPrice}
                    </div>
                </div>
            ),
            {
                width: 950,
                height: 1300,
                fonts: [
                    { name: 'Geist', data: blackData, style: 'normal', weight: 900 },
                    { name: 'Geist', data: regularData, style: 'normal', weight: 400 },
                ],
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=3600',
                },
            }
        );
    } catch (error) {
        console.error('图片生成失败:', error);
        return new Response(JSON.stringify({ error: '图片生成失败', message: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

