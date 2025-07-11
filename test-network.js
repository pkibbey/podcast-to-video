import dotenv from 'dotenv';
dotenv.config();

// Simple network test
async function testNetwork() {
  console.log('🧪 Testing Network Connectivity...');
  
  try {
    console.log('📡 Checking basic connectivity...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch('https://httpbin.org/status/200', {
      method: 'HEAD',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      console.log('✅ Network connectivity confirmed');
      
      // Now test Freesound with shorter timeout
      console.log('🎵 Testing Freesound connectivity...');
      
      const freesoundController = new AbortController();
      const freesoundTimeoutId = setTimeout(() => freesoundController.abort(), 8000); // 8 second timeout
      
      // Use the correct Freesound API format: add token as query parameter
      const freesoundUrl = `https://freesound.org/apiv2/search/text/?query=test&page_size=1&token=${process.env.FREESOUND_API_KEY}`;
      
      const freesoundResponse = await fetch(freesoundUrl, {
        method: 'GET', // Change to GET since we're doing a search
        signal: freesoundController.signal,
        headers: {
          'User-Agent': 'PodcastToVideo/1.0 (Educational Use)'
        }
      });
      
      clearTimeout(freesoundTimeoutId);
      
      if (freesoundResponse.ok) {
        console.log('freesoundResponse: ', freesoundResponse);
        console.log('✅ Freesound.org is reachable and API key is valid');
        
        // Try to parse the response to verify we're getting data
        try {
          const data = await freesoundResponse.json();
          console.log('📊 Sample response:', {
            count: data.count,
            resultsFound: data.results?.length || 0
          });
        } catch (parseError) {
          console.log('⚠️ Could not parse response, but API is accessible');
        }
        
        console.log('💡 The timeout issue should be resolved with the new retry logic');
      } else if (freesoundResponse.status === 401) {
        console.log('❌ Freesound returned 401 - Invalid API key');
        console.log('🔧 Please check your FREESOUND_API_KEY in the .env file');
      } else {
        console.log('⚠️ Freesound returned:', freesoundResponse.status);
        console.log('📄 Response text:', await freesoundResponse.text().catch(() => 'Could not read response'));
      }
      
    } else {
      console.log('❌ No network connectivity');
    }
    
  } catch (error) {
    console.log('❌ Network test failed:', error.message);
    console.log('🔧 Possible solutions:');
    console.log('  - Check internet connection');
    console.log('  - Try using a VPN if behind a firewall');
    console.log('  - Verify your FREESOUND_API_KEY is correct');
    console.log('  - The system will automatically fall back to local/synthetic music');
  }
}

testNetwork();
