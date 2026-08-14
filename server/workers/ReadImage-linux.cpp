#include <iostream>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>      // for usleep(), close()
#include <arpa/inet.h>   // for inet_pton()
#include <sys/socket.h>  // for socket APIs
#include <pthread.h>     // for threading
#include <fcntl.h>
#include <time.h>
#include <ctype.h>
#include <errno.h>


// Timer tick in milliseconds
#define TIMER_TICK 10

// Global control flag for program execution
unsigned short run_flag = 1;

// Maximum JPEG size = 230 KB
#define MAX_IMAGE_SIZE (230 * 1024)

// Socket descriptor for camera connection
int sckConnImg = -1;

// Structure to hold server (camera) address
struct sockaddr_in sockinImg;

// Thread handlers
pthread_t kb_thread, tmr_thread;

// Final filename
char filename[4096];

// Timer Thread
// Decreases run_flag periodically → acts like timeout
void* tmr_handler(void* arg)
{
    while (run_flag)
    {
        usleep(TIMER_TICK * 1000);

        // Decrement run_flag until it reaches 0
        if (run_flag) run_flag--;
    }
    usleep(100000);
    return NULL;
}


// Keyboard Thread
// Allows manual termination using 'Q'
void* kb_handler(void* arg)
{
    printf("\nStarting KB handler\n");
    while (run_flag)
    {
        int ch = getchar(); // blocking input

        // If user presses 'Q' or 'q', stop program
        if (toupper(ch) == 'Q')
        {
            run_flag = 0;
            return NULL;
        }
        usleep(100000);
    }
    return NULL;
}


// Establish TCP connection to camera
void ConnectImage(const char* remoteip)
{
    // Camera port
    int dest_port = 8324;

    // Validate IP
    if (!remoteip || strlen(remoteip) < 5)
    {
        printf("\nError: Invalid IP\n");
        return;
    }

    // Create TCP socket
    sckConnImg = socket(AF_INET, SOCK_STREAM, 0);
    if (sckConnImg < 0)
    {
        perror("socket failed");
        return;
    }

    // Clear and setup address structure
    memset(&sockinImg, 0, sizeof(sockinImg));
    sockinImg.sin_family = AF_INET;
    sockinImg.sin_port = htons(dest_port);

    // Convert IP string to binary
    inet_pton(AF_INET, remoteip, &sockinImg.sin_addr);

    // Connect to camera
    if (connect(sckConnImg, (struct sockaddr*)&sockinImg, sizeof(sockinImg)) < 0)
    {
        printf("\nNot able to connect to %s:%d\n", remoteip, dest_port);
        return;
    }
}


// Generate filename using timestamp
void get_timestamp_filename(char* buffer, size_t buffer_size)
{
    time_t raw_time;
    struct tm* time_info;

    time(&raw_time);
    time_info = localtime(&raw_time);

    // Format: YYYYMMDD_HHMMSS.jpeg
    strftime(buffer, buffer_size, "%Y%m%d_%H%M%S.jpeg", time_info);
}


// ============================================================
// APPLY CAMERA ID PREFIX
//
// No ID:
//      image.jpg
//
// Matching ID:
//      1_image.jpg
//
// Non-matching ID:
//      INV_image.jpg
// ============================================================

void apply_id_prefix(
    const char* outputPath,
    const char* expectedId,
    bool id_match
)
{
    // No camera ID supplied
    if (expectedId == NULL)
    {
        strncpy(
            filename,
            outputPath,
            sizeof(filename) - 1
        );

        filename[sizeof(filename) - 1] = '\0';

        return;
    }

    // Matching ID -> use ID
    // Non matching -> INV
    const char* prefix =
        id_match ? expectedId : "INV";

    // Find last directory separator
    const char* last_slash =
        strrchr(outputPath, '/');

    if (last_slash)
    {
        size_t directory_length =
            last_slash - outputPath + 1;

        if (directory_length >= sizeof(filename))
        {
            printf(
                "\n[ERROR] Output path is too long\n"
            );
            return;
        }

        // Copy directory
        strncpy(
            filename,
            outputPath,
            directory_length
        );

        filename[directory_length] = '\0';

        // Add prefix
        snprintf(
            filename + directory_length,
            sizeof(filename) - directory_length,
            "%s_%s",
            prefix,
            last_slash + 1
        );
    }
    else
    {
        // No directory
        snprintf(
            filename,
            sizeof(filename),
            "%s_%s",
            prefix,
            outputPath
        );
    }

    printf(
        "\nFinal image filename: %s\n",
        filename
    );
}


// Save received image to file
void save_image(unsigned char* img_data, unsigned long img_size)
{
    printf("Attempting to save: %s\n", filename);

    // Open file in binary write mode
    FILE* fp = fopen(filename, "wb");

    // Error handling if file cannot be created
    if (!fp)
    {
        perror("fopen failed");
        printf("Path: %s\n", filename);
        return;
    }

    // Write image data
    fwrite(img_data, 1, img_size, fp);
    fclose(fp);

    printf("Saved successfully: %s (%lu bytes)\n", filename, img_size);
}


// Receive JPEG image from camera
void recv_jpeg(const char* outputPath, const char* expectedId)
{
    // First 8 bytes = image size
    const int HEADER_SIZE = 8;
    // Safety limit (230 KB)
    //const int MAX_IMAGE_SIZE = 230 * 1024;

    char header[HEADER_SIZE + 1] = {0};
    int header_received = 0;
    unsigned long image_size = 0;
    unsigned long image_received = 0;
    unsigned char* image_buffer = NULL;

    printf("\nPhase 1: Waiting for header...\n");

    // Step 1: Receive header (image size)
    while (header_received < HEADER_SIZE)
    {
        int n = recv(sckConnImg, header + header_received, HEADER_SIZE - header_received, 0);
        if (n <= 0)
        {
            perror("recv header failed");
            return;
        }
        header_received += n;
    }

    // Convert header string to integer
    header[HEADER_SIZE] = '\0';

    // --------------------------------------------------------
    // CAMERA ID VALIDATION
    // --------------------------------------------------------

    bool id_match = false;

    if (expectedId != NULL)
    {
        // Windows version expects one character ID
        id_match =
            (
                expectedId[0] == header[0] &&
                expectedId[1] == '\0'
                );

        printf(
            "\nExpected ID: %s",
            expectedId
        );

        printf(
            "\nHeader first byte: 0x%02X",
            (unsigned char)header[0]
        );

        printf(
            "\nID Match: %s",
            id_match ? "YES" : "NO"
        );
    }
    else
    {
        printf(
            "\nCamera ID: Not provided"
        );
    }


    //image_size = atoi(header);

    // --------------------------------------------------------
    // DETERMINE FINAL FILE NAME
    // --------------------------------------------------------

    apply_id_prefix(
        outputPath,
        expectedId,
        id_match
    );


    // --------------------------------------------------------
    // IMAGE SIZE
    //
    // First 2 bytes ignored
    // Last 6 bytes = ASCII image size
    // --------------------------------------------------------

    char image_size_str[7] = { 0 };

    memcpy(
        image_size_str,
        header + 2,
        6
    );

    image_size_str[6] = '\0';


    // --------------------------------------------------------
    // HEADER DEBUG
    // --------------------------------------------------------

    printf(
        "\n\n========== LOGGING IMAGE HEADER =========="
    );

    printf(
        "\nHeader as string: [%s]",
        header
    );

    printf(
        "\nHeader bytes: "
    );

    for (int i = 0; i < HEADER_SIZE; i++)
    {
        printf(
            "%02X ",
            (unsigned char)header[i]
        );
    }

    printf(
        "\nFirst byte: 0x%02X (%u) '%c'",
        (unsigned char)header[0],
        (unsigned char)header[0],
        isprint((unsigned char)header[0])
        ? header[0]
        : '.'
    );

    printf(
        "\nFirst byte bits: "
    );

    for (int i = 7; i >= 0; i--)
    {
        printf(
            "%d",
            ((unsigned char)header[0] >> i) & 1
        );
    }

    printf(
        "\n=========================================="
    );


    // --------------------------------------------------------
    // PARSE IMAGE SIZE
    // --------------------------------------------------------

    image_size =
        strtoul(
            image_size_str,
            NULL,
            10
        );

    printf(
        "\nHeader received: [%s]",
        header
    );

    printf(
        "\nFirst 2 bytes (ignored): %02X %02X",
        (unsigned char)header[0],
        (unsigned char)header[1]
    );

    printf(
        "\nLast 6 bytes (image size): [%s]",
        image_size_str
    );

    printf(
        "\nImage size parsed: %lu bytes",
        image_size
    );

    printf("Image size: %lu\n", image_size);

    // Validate size
    if (image_size <= 0 || image_size > MAX_IMAGE_SIZE)
    {
        printf("Invalid image size\n");
        return;
    }

    // Step 2: Allocate buffer for image
    image_buffer = (unsigned char*)malloc(image_size);
    if (!image_buffer)
    {
        printf("Memory allocation failed\n");
        return;
    }

    printf("Receiving image...\n");

    // Step 3: Receive image data
    while (image_received < image_size)
    {
        int n = recv(sckConnImg, image_buffer + image_received, image_size - image_received, 0);
        if (n <= 0) break;
        image_received += n;
    }

    // Step 4: Save image
    if (image_received > 0)
    {
        printf("Received %lu bytes\n", image_received);
        save_image(image_buffer, image_received);
    }

    // Cleanup
    free(image_buffer);

    // Stop main loop after one image
    run_flag = 0;
}

int main(int argc, char* argv[])
{
    printf("\nRead Image : Press Q to terminate at any time\n");

    // Check input arguments
    if (
        argc >= 2 &&
        (
            strcmp(argv[1], "?") == 0 ||
            strcmp(argv[1], "-?") == 0 ||
            strcmp(argv[1], "--help") == 0
            )
        )
    {
        printf(
            "\n\nUSAGE:"
        );

        printf(
            "\n  ./ReadImage <IP> <OutputPath> [ID]"
        );

        printf(
            "\n\nExample without ID:"
        );

        printf(
            "\n  ./ReadImage 192.168.0.61 /snaps/0_61/image.jpg"
        );

        printf(
            "\n\nExample with ID:"
        );

        printf(
            "\n  ./ReadImage 192.168.0.61 /snaps/0_61/image.jpg 2"
        );

        printf(
            "\n\nFilename behavior:"
        );

        printf(
            "\n  No ID       -> image.jpg"
        );

        printf(
            "\n  Matching ID -> 2_image.jpg"
        );

        printf(
            "\n  Wrong ID    -> INV_image.jpg"
        );

        printf(
            "\n"
        );

        return 0;
    }

    // --------------------------------------------------------
   // ARGUMENT VALIDATION
   // --------------------------------------------------------

    if (argc < 3)
    {
        printf(
            "\nUsage: ./ReadImage <IP> <OutputPath> [ID]"
        );

        printf(
            "\n"
        );

        return 1;
    }

    const char* ip = argv[1];
    const char* outputPath = argv[2];

    const char* expectedId = NULL;

    if (argc >= 4)
    {
        expectedId = argv[3];

        printf(
            "\nCamera ID: %s\n",
            expectedId
        );
    }
    else
    {
        printf(
            "\nCamera ID: Not provided\n"
        );
    }


    // Initialize run flag (acts as timeout counter)
    run_flag = 200;

    // Start keyboard + timer threads
    pthread_create(&kb_thread, NULL, kb_handler, NULL);
    pthread_create(&tmr_thread, NULL, tmr_handler, NULL);

    // get_timestamp_filename(filename, sizeof(filename));

    printf("Output path: %s\n", outputPath);

    // Connect to camera
    ConnectImage(argv[1]);

    int ticker = 0;

    // Main execution loop
    while (run_flag)
    {
        // If socket is valid, receive image
        if (sckConnImg >= 0)
        {
            recv_jpeg(outputPath, expectedId);
        }

        usleep(10000);

        // Print heartbeat indicator
        if (ticker++ > 10)
        {
            printf(".");
            fflush(stdout);
            ticker = 0;
        }
    }
    
    // Close socket
    close(sckConnImg);

    // allow cleanup
    usleep(100000);

    return 0;
}