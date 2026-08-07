import { ImageResponse } from 'next/og';
import { prisma } from "@/server/prisma";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const template = await prisma.template.findUnique({
      where: { id: params.id },
      select: { name: true, kind: true }
    });

    if (!template) {
      return new Response('Not found', { status: 404 });
    }

    const isEmail = template.kind === "EMAIL";
    
    // Create a highly stylized, abstract "Snapshot" cover using next/og
    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#080c14',
            backgroundImage: isEmail 
              ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(252, 6, 148, 0.05) 100%)'
              : 'linear-gradient(135deg, rgba(129, 140, 248, 0.2) 0%, rgba(129, 140, 248, 0.05) 100%)',
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 80,
            height: 80,
            borderRadius: 20,
            background: 'rgba(255, 255, 255, 0.1)',
            marginBottom: 20,
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={isEmail ? "#a78bfa" : "#818cf8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isEmail ? (
                <>
                  <rect x="2" y="4" width="20" height="16" rx="3"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </>
              ) : (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <path d="M3 9h18M9 21V9"/>
                </>
              )}
            </svg>
          </div>
          
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-0.02em',
              textAlign: 'center',
              padding: '0 40px',
            }}
          >
            {template.name}
          </div>
          
          <div style={{
            marginTop: 10,
            fontSize: 16,
            fontWeight: 600,
            color: isEmail ? '#a78bfa' : '#818cf8',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            {isEmail ? 'Email Blueprint' : 'Page Blueprint'}
          </div>
        </div>
      ),
      {
        width: 800,
        height: 400,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      }
    );
  } catch (error) {
    console.error('Error generating snapshot:', error);
    return new Response('Failed to generate snapshot', { status: 500 });
  }
}
