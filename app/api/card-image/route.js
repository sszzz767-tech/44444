// /app/api/card-image/route.js
// 最终版 —— 同时加载 Geist-Black (900) 和 Geist-Regular (400)
import { ImageResponse } from '@vercel/og';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// ...（中间辅助函数不变，省略以节省篇幅，请保留您原有的 formatPriceSmart, calculateProfit, getBeijingTime 等函数）...

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

        // 同时加载两个字体
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
                    {/* 右上角：时间（使用 Geist Regular，字重 400） */}
                    <div style={{
                        position: 'absolute',
                        right: '445px',
                        top: '145px',
                        fontSize: '33px',
                        fontWeight: 400,
                        fontFamily: 'Geist',
                        color: '#F0F0F0',
                        letterSpacing: '0.5px',
                    }}>
                        {displayTime}
                    </div>

                    {/* 交易对（使用 Geist Black，字重 900） */}
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

                    {/* 方向（Geist Black，绿色 #00FA9A） */}
                    <div style={{
                        position: 'absolute',
                        left: '53px',
                        top: '470px',
                        fontSize: '35px',
                        fontWeight: 900,
                        fontFamily: 'Geist',
                        color: displayDirection === '卖' ? '#cc3333' : '#00FA9A',
                    }}>
                        {displayDirection}
                    </div>

                    {/* 盈利金额（Geist Black，绿色 #00FA9A） */}
                    <div style={{
                        position: 'absolute',
                        left: '55px',
                        top: '585px',
                        fontSize: '90px',
                        fontWeight: 900,
                        fontFamily: 'Geist',
                        color: profitAmount >= 0 ? '#00FA9A' : '#cc3333',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                    }}>
                        <span>{displayProfit}</span>
                    </div>

                    {/* 开仓价格（Geist Regular，字重 400） */}
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

                    {/* 最新价格（Geist Regular，字重 400） */}
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
                    {
                        name: 'Geist',
                        data: blackData,
                        style: 'normal',
                        weight: 900,
                    },
                    {
                        name: 'Geist',
                        data: regularData,
                        style: 'normal',
                        weight: 400,
                    },
                ],
                headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
            }
        );
    } catch (error) {
        console.error('图片生成失败:', error);
        return new Response(JSON.stringify({ error: '图片生成失败', message: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
