
import AudioUpload from '@/components/AudioUpload'

export default async function JobPage({ params }: { params: { jobId: string } }) {
  const { jobId } = await params
  // Pass jobId as prop to AudioUpload for job resuming

  return (
    <main className="min-h-screen bg-gray-50">
      <AudioUpload jobId={jobId} />
    </main>
  )
}
