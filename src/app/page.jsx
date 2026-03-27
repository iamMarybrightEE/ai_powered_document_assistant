'use client';

import { Suspense } from 'react';
import { Box, CircularProgress, Container, Typography } from '@mui/material';
import DocumentAssistant from '@/components/DocumentAssistant';

function HomeContent() {
  const documentId = "default-document";

  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f5f7fa 0%, #f0f4f8 50%, #e8f1fc 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <Container maxWidth="md" sx={{ position: 'relative', zIndex: 1 }}>
        

        {/* Main Component */}
        <DocumentAssistant documentId={documentId} />

        {/* Footer */}
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            textAlign: 'center',
            mt: 3,
            color: '#999',
            fontSize: '0.8rem',
          }}
        >
          Designed by Marybright Etim
        </Typography>
      </Container>
    </main>
  );
}

function HomeLoading() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f5f7fa 0%, #f0f4f8 100%)',
        gap: 2,
      }}
    >
      <CircularProgress sx={{ color: '#004497' }} size={50} />
      <Typography color="#666">Loading Document Assistant...</Typography>
    </Box>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeContent />
    </Suspense>
  );
}


