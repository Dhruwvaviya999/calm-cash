// @vitest-environment jsdom
import type { ReceiptDto } from '@calmcash/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/lib/api-client';

import { ReceiptsPanel } from './receipts-panel';

const services = vi.hoisted(() => ({
  listReceipts: vi.fn(),
  uploadReceipt: vi.fn(),
  downloadReceipt: vi.fn(),
  removeReceipt: vi.fn(),
}));
vi.mock('@/services/receipts.service', () => services);

const TRANSACTION = '0193a000-0000-7000-8000-000000000301';

function receipt(id: string, fileName: string, contentType: ReceiptDto['contentType']): ReceiptDto {
  return {
    id,
    transactionId: TRANSACTION,
    fileName,
    contentType,
    sizeBytes: 245_760,
    sha256: 'a'.repeat(64),
    createdAt: '2026-10-26T05:15:00.000Z',
  };
}

const photo = receipt('0193a000-0000-7000-8000-000000000401', 'dinner.jpg', 'image/jpeg');
const invoice = receipt('0193a000-0000-7000-8000-000000000402', 'invoice.pdf', 'application/pdf');

function renderPanel(readOnly = false): void {
  render(<ReceiptsPanel transactionId={TRANSACTION} timeZone="Asia/Kolkata" readOnly={readOnly} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  services.listReceipts.mockResolvedValue({ receipts: [photo, invoice] });
  URL.createObjectURL = vi.fn(() => 'blob:receipt');
  URL.revokeObjectURL = vi.fn();
});

describe('ReceiptsPanel', () => {
  it('lists receipts with their type, size, and date', async () => {
    renderPanel();
    const list = await screen.findByRole('list');
    expect(within(list).getByText('dinner.jpg')).toBeTruthy();
    expect(within(list).getByText(/PDF · 240 KB · Added 26 Oct 2026/)).toBeTruthy();
    // Images can be previewed; PDFs are only saved, never rendered inline.
    expect(screen.getByRole('button', { name: 'Preview dinner.jpg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview invoice.pdf' })).toBeNull();
  });

  it('attaches a file and refreshes the list', async () => {
    const user = userEvent.setup();
    const added = receipt('0193a000-0000-7000-8000-000000000403', 'taxi.png', 'image/png');
    services.uploadReceipt.mockResolvedValue(added);
    renderPanel();
    await screen.findByText('dinner.jpg');
    services.listReceipts.mockResolvedValue({ receipts: [photo, invoice, added] });

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'taxi.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Receipt file'), file);

    expect(services.uploadReceipt).toHaveBeenCalledWith(TRANSACTION, file);
    expect(await screen.findByText('taxi.png was attached.')).toBeTruthy();
    expect(await screen.findByText('taxi.png')).toBeTruthy();
  });

  it('refuses files over 10 MB before uploading, and shows why the API refused one', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('dinner.jpg');

    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'scan.pdf', {
      type: 'application/pdf',
    });
    await user.upload(screen.getByLabelText('Receipt file'), huge);
    expect(
      await screen.findByText(/scan\.pdf is 10\.0 MB\. Receipts can be at most 10 MB\./),
    ).toBeTruthy();
    expect(services.uploadReceipt).not.toHaveBeenCalled();

    services.uploadReceipt.mockRejectedValue(
      new ApiClientError({
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        status: 400,
        details: [
          { path: 'body', message: 'The file name ends in .png, but its content is a PDF.' },
        ],
      }),
    );
    await user.upload(
      screen.getByLabelText('Receipt file'),
      new File(['%PDF-1.4'], 'photo.png', { type: 'image/png' }),
    );
    expect(
      await screen.findByText('The file name ends in .png, but its content is a PDF.'),
    ).toBeTruthy();
  });

  it('previews an image through the authorised API', async () => {
    const user = userEvent.setup();
    services.downloadReceipt.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Preview dinner.jpg' }));

    expect(services.downloadReceipt).toHaveBeenCalledWith(TRANSACTION, photo.id);
    const image = await screen.findByRole('img', { name: 'Receipt dinner.jpg' });
    expect(image.getAttribute('src')).toBe('blob:receipt');
  });

  it('removes a receipt only after confirmation', async () => {
    const user = userEvent.setup();
    services.removeReceipt.mockResolvedValue(undefined);
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Remove invoice.pdf' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/The transaction itself does not change/)).toBeTruthy();
    expect(services.removeReceipt).not.toHaveBeenCalled();
    services.listReceipts.mockResolvedValue({ receipts: [photo] });
    await user.click(within(dialog).getByRole('button', { name: 'Remove receipt' }));

    await waitFor(() => {
      expect(services.removeReceipt).toHaveBeenCalledWith(TRANSACTION, invoice.id);
    });
    expect(await screen.findByText('invoice.pdf was removed.')).toBeTruthy();
  });

  it('is read-only for archived accounts', async () => {
    renderPanel(true);
    await screen.findByText('dinner.jpg');
    expect(screen.queryByRole('button', { name: /Attach/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByLabelText('Receipt file')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save invoice.pdf' })).toBeTruthy();
  });
});
