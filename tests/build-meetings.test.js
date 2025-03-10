const { google } = require('googleapis');
const path = require('path');
const { readFileSync, mkdirSync, rmSync } = require('fs');
const { buildMeetings } = require('../scripts/build-meetings.ts');
const { mockEvents, expectedContent } = require('./fixtures/meetingsData');

jest.mock('googleapis', () => {
  const events = {
    list: jest.fn()
  };
  const calendar = {
    events
  };
  const mockGoogle = {
    calendar: jest.fn(() => calendar),
    auth: {
      GoogleAuth: jest.fn(() => ({
        getClient: jest.fn()
      }))
    }
  };
  return { google: mockGoogle };
});

describe('buildMeetings', () => {
  const testDir = path.join(__dirname, 'testCache');
  const outputFilePath = path.join(testDir, 'meetings.json');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CALENDAR_SERVICE_ACCOUNT = JSON.stringify({ key: 'test_key' });
    process.env.CALENDAR_ID = 'test_calendar_id';

    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should fetch events, process them, and write to a file', async () => {
    google.calendar().events.list.mockResolvedValue({ data: { items: mockEvents } });

    await buildMeetings(outputFilePath);

    expect(google.auth.GoogleAuth).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/calendar'],
      credentials: { key: 'test_key' }
    });
    expect(google.calendar).toHaveBeenCalled();
    expect(google.calendar().events.list).toHaveBeenCalledWith({
      calendarId: 'test_calendar_id',
      timeMax: expect.any(String),
      timeMin: expect.any(String)
    });

    const fileContent = readFileSync(outputFilePath, 'utf8');
    const parsedContent = JSON.parse(fileContent);

    expect(parsedContent).toEqual(expectedContent);
  });

  it('should throw an error if the Google API call fails', async () => {
    google.calendar().events.list.mockRejectedValue(new Error('Google API error'));

    try {
      await buildMeetings(outputFilePath);
    } catch (err) {
      expect(err.message).toContain('Google API error');
    }
  });

  it('should handle undefined CALENDAR_SERVICE_ACCOUNT', async () => {
    delete process.env.CALENDAR_SERVICE_ACCOUNT;

    google.calendar().events.list.mockResolvedValue({ data: { items: [] } });

    await buildMeetings(outputFilePath);

    expect(google.auth.GoogleAuth).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/calendar'],
      credentials: undefined
    });

    const fileContent = readFileSync(outputFilePath, 'utf8');
    expect(fileContent).toBe('[]');
  });

  it('should throw an error if authentication fails', async () => {
    google.auth.GoogleAuth.mockImplementation(() => {
      throw new Error('Authentication failed');
    });

    try {
      await buildMeetings(outputFilePath);
    } catch (err) {
      expect(err.message).toContain('Authentication failed');
    }
  });

  it('should handle file write errors', async () => {
    google.auth.GoogleAuth.mockImplementation(() => ({
      getClient: jest.fn()
    }));

    google.calendar().events.list.mockResolvedValue({ data: { items: mockEvents } });

    const invalidPath = '/root/invalid_dir/meetings.json';

    try {
      await buildMeetings(invalidPath);
    } catch (err) {
      expect(err.message).toMatch(/ENOENT|EACCES/);
    }
  });

  it('should throw an error if the data structure received from Google Calendar API is invalid', async () => {
    const mockCalendar = google.calendar().events.list;
    mockCalendar.mockResolvedValueOnce({
      data: {
        items: null // or {} or any non-array value to trigger the error
      }
    });

    await expect(buildMeetings('/path/to/write')).rejects.toThrow(
      'Invalid data structure received from Google Calendar API'
    );
  });

  it('should throw an error if start.dateTime is missing in the event', async () => {
    const mockCalendar = google.calendar().events.list;
    mockCalendar.mockResolvedValueOnce({
      data: {
        items: [
          {
            summary: 'Test Event',
            htmlLink: 'http://example.com/event',
            // start.dateTime is intentionally missing to trigger the error
            start: {}
          }
        ]
      }
    });

    await expect(buildMeetings('/path/to/write')).rejects.toThrow('start.dateTime is missing in the event');
  });
});
